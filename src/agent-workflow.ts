import { proxyActivities, log } from '@temporalio/workflow';
import type * as agentActivities from './agent-activities';
import type {
  AgentDecision,
  AgentInput,
  AgentMessage,
  AgentMessageContent,
  AgentRecommendation,
  AgentToolCall,
} from './models';

// LLM call uses Temporal's default retry policy (unlimited attempts with
// exponential backoff). Transient Ollama hiccups — model load stalls, network
// blips, container restarts — recover automatically. Tradeoff: LLM calls are
// not idempotent, so a retry after a late timeout may produce slightly different
// tool calls than the first would have.
const { callAgentLLM } = proxyActivities<typeof agentActivities>({
  // Generous per-attempt timeout — first Ollama call pays model-load cost;
  // subsequent turns on a warm model are much faster.
  startToCloseTimeout: '3 minutes',
});

// Tool activities are deterministic mock lookups — standard retry is fine.
const { lookupFullCreditReport, checkComplianceWatchlist, getPropertyComparables } =
  proxyActivities<typeof agentActivities>({
    startToCloseTimeout: '10 seconds',
  });

// Hard cap prevents runaway tool-call loops if the model gets stuck.
// On cap hit we escalate to the human approver rather than silently continuing.
const MAX_TURNS = 15;

const SYSTEM_PROMPT = `You are a senior mortgage underwriter AI. You will receive a loan application and must produce a final recommendation by calling tools.

Available tools (all read-only):
- lookupFullCreditReport: detailed credit history beyond the basic score
- checkComplianceWatchlist: OFAC / sanctions screening
- getPropertyComparables: market comparables for the subject property

Process:
1. Call info tools you need — typically 2-3 calls is enough. Do not call the same tool twice with the same arguments.
2. When you have enough information, stop calling tools and reply with your final recommendation in this EXACT format, each field on its own line:
   DECISION: APPROVE | DECLINE | ESCALATE
   CONFIDENCE: <number between 0.0 and 1.0>
   RATIONALE: <2-3 sentences citing the specific tool results you relied on>

Guidelines:
- DECLINE if compliance watchlist returns MATCH, or if credit shows multiple serious red flags (several delinquencies + high utilization).
- ESCALATE when data is inconclusive or unusual.
- APPROVE when credit is healthy, compliance is clear, and property comparables support the loan amount.

Do not fabricate values. Reason only from what the tools return.`;

function formatApplicationMessage(input: AgentInput): string {
  const app = input.application;
  return `Review this loan application:
- Application ID: ${app.applicationId}
- Applicant: ${app.applicantName}
- SSN: ${app.ssn}
- Employer: ${app.employerName}
- Annual income: $${app.annualIncome.toLocaleString()}
- Property: ${app.propertyAddress} (ID ${app.propertyId})
- Requested loan: $${app.loanAmount.toLocaleString()}
- Down payment: $${app.downPayment.toLocaleString()}
- Preliminary credit score: ${input.creditScore}

Use the available tools to gather information, then call submitRecommendation.`;
}

// Pull DECISION / CONFIDENCE / RATIONALE out of the model's free-text reply.
// Returns null if no DECISION line is present — caller escalates in that case.
function parseRecommendation(
  text: string
): { decision: AgentDecision; confidence: number; rationale: string } | null {
  const decisionMatch = text.match(/DECISION\s*:\s*(APPROVE|DECLINE|ESCALATE)/i);
  if (!decisionMatch) return null;
  const confidenceMatch = text.match(/CONFIDENCE\s*:\s*(\d*\.?\d+)/i);
  const rationaleMatch = text.match(/RATIONALE\s*:\s*([\s\S]+?)(?:\n\s*\n|$)/i);
  const confidence = confidenceMatch ? Math.min(1, Math.max(0, parseFloat(confidenceMatch[1]))) : 0.5;
  return {
    decision: decisionMatch[1].toUpperCase() as AgentDecision,
    confidence,
    rationale: rationaleMatch ? rationaleMatch[1].trim() : text.trim(),
  };
}

async function dispatchTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  try {
    switch (name) {
      case 'lookupFullCreditReport':
        return await lookupFullCreditReport(
          String(args.applicationId ?? ''),
          String(args.ssn ?? '')
        );
      case 'checkComplianceWatchlist':
        return await checkComplianceWatchlist(
          String(args.applicantName ?? ''),
          String(args.ssn ?? '')
        );
      case 'getPropertyComparables':
        return await getPropertyComparables(
          String(args.propertyId ?? ''),
          String(args.propertyAddress ?? '')
        );
      default:
        return JSON.stringify({
          error: `Unknown tool '${name}'. Available: lookupFullCreditReport, checkComplianceWatchlist, getPropertyComparables.`,
        });
    }
  } catch (e: any) {
    return JSON.stringify({ error: e.message || String(e) });
  }
}

export async function underwritingAgentWorkflow(
  input: AgentInput
): Promise<AgentRecommendation> {
  const messages: AgentMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: formatApplicationMessage(input) },
  ];
  const toolCallTrace: AgentToolCall[] = [];
  let lastModel = '';

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    log.info(`Agent turn ${turn}/${MAX_TURNS}`);
    const resp = await callAgentLLM({ messages });
    lastModel = resp.model;

    // Record the assistant's turn (text + any tool calls it requested)
    const assistantParts: AgentMessageContent[] = [];
    if (resp.text) assistantParts.push({ type: 'text', text: resp.text });
    for (const tc of resp.toolCalls) {
      assistantParts.push({
        type: 'tool-call',
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        args: tc.args,
      });
    }
    messages.push({ role: 'assistant', content: assistantParts });

    // No tool calls — the model has produced its final answer in plain text.
    // Parse the structured DECISION/CONFIDENCE/RATIONALE block out of it.
    if (resp.toolCalls.length === 0) {
      const parsed = parseRecommendation(resp.text);
      if (parsed) {
        return {
          ...parsed,
          toolCallTrace,
          turns: turn,
          model: lastModel,
          completedAt: new Date().toISOString(),
        };
      }
      log.warn('Agent stopped without a parseable recommendation');
      return {
        decision: 'ESCALATE',
        confidence: 0,
        rationale: `Could not parse recommendation. Last text: "${resp.text.slice(0, 200)}"`,
        toolCallTrace,
        turns: turn,
        model: lastModel,
        completedAt: new Date().toISOString(),
      };
    }

    // Dispatch info tools and feed results back
    const toolResultParts: AgentMessageContent[] = [];
    for (const tc of resp.toolCalls) {
      const result = await dispatchTool(tc.toolName, tc.args);
      toolCallTrace.push({ tool: tc.toolName, args: tc.args, result });
      toolResultParts.push({
        type: 'tool-result',
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        result,
      });
    }
    messages.push({ role: 'tool', content: toolResultParts });
  }

  log.warn(`Agent hit max turns (${MAX_TURNS}) without submitting`);
  return {
    decision: 'ESCALATE',
    confidence: 0,
    rationale: `Agent reached max turns (${MAX_TURNS}) without submitting a recommendation. A human should review.`,
    toolCallTrace,
    turns: MAX_TURNS,
    model: lastModel,
    completedAt: new Date().toISOString(),
  };
}
