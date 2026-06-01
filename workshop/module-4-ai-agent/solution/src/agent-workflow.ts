// The AI underwriting agent, running as its own child workflow.
//
// The key idea: each LLM call is non-deterministic, so it lives in an ACTIVITY
// (callAgentLLM). The WORKFLOW drives the loop — call the model, run whatever
// tools it asks for (each its own activity), feed the results back, repeat —
// until the model stops asking for tools and gives a final answer. Every step
// is recorded in history, so the whole agent run is durable and replayable.

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

// The LLM call gets a generous timeout (the first call pays the model-load cost)
// and Temporal's default retry policy, so a transient Ollama blip recovers itself.
const { callAgentLLM } = proxyActivities<typeof agentActivities>({
  startToCloseTimeout: '60 seconds',
});

const { lookupFullCreditReport, checkComplianceWatchlist } = proxyActivities<typeof agentActivities>({
  startToCloseTimeout: '10 seconds',
});

// Hard cap so a confused model can't loop forever. On cap we escalate to a human.
const MAX_TURNS = 10;

const SYSTEM_PROMPT = `You are a senior mortgage underwriter AI. Review a loan application and produce a recommendation by calling tools.

Available tools (read-only):
- lookupFullCreditReport: detailed credit history beyond the basic score
- checkComplianceWatchlist: OFAC / sanctions screening

Process:
1. Call the tools you need — usually one or two calls is enough. Don't call the same tool twice with the same arguments.
2. When you have enough information, STOP calling tools and reply with your final recommendation in this EXACT format, each field on its own line:
   DECISION: APPROVE | DECLINE | ESCALATE
   CONFIDENCE: <number between 0.0 and 1.0>
   RATIONALE: <2-3 sentences citing the tool results you used>

Guidelines:
- DECLINE if the compliance watchlist returns MATCH, or credit shows multiple serious red flags.
- ESCALATE when data is inconclusive.
- APPROVE when credit is healthy and compliance is clear.
Reason only from what the tools return.`;

function formatApplication(input: AgentInput): string {
  const a = input.application;
  return `Review this loan application:
- Application ID: ${a.applicationId}
- Applicant: ${a.applicantName}
- SSN: ${a.ssn}
- Annual income: $${a.annualIncome.toLocaleString()}
- Requested loan: $${a.loanAmount.toLocaleString()}, down payment: $${a.downPayment.toLocaleString()}
- Preliminary credit score: ${input.creditScore}`;
}

// Pull DECISION / CONFIDENCE / RATIONALE out of the model's free-text reply.
function parseRecommendation(
  text: string
): { decision: AgentDecision; confidence: number; rationale: string } | null {
  const decision = text.match(/DECISION\s*:\s*(APPROVE|DECLINE|ESCALATE)/i);
  if (!decision) return null;
  const conf = text.match(/CONFIDENCE\s*:\s*(\d*\.?\d+)/i);
  const rationale = text.match(/RATIONALE\s*:\s*([\s\S]+?)(?:\n\s*\n|$)/i);
  return {
    decision: decision[1].toUpperCase() as AgentDecision,
    confidence: conf ? Math.min(1, Math.max(0, parseFloat(conf[1]))) : 0.5,
    rationale: rationale ? rationale[1].trim() : text.trim(),
  };
}

// Route a tool call to the matching activity.
async function dispatchTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'lookupFullCreditReport':
      return lookupFullCreditReport(String(args.applicationId ?? ''), String(args.ssn ?? ''));
    case 'checkComplianceWatchlist':
      return checkComplianceWatchlist(String(args.applicantName ?? ''), String(args.ssn ?? ''));
    default:
      return JSON.stringify({ error: `Unknown tool '${name}'.` });
  }
}

export async function underwritingAgentWorkflow(input: AgentInput): Promise<AgentRecommendation> {
  const messages: AgentMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: formatApplication(input) },
  ];
  const toolCallTrace: AgentToolCall[] = [];
  let model = '';

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    log.info(`Agent turn ${turn}/${MAX_TURNS}`);
    const resp = await callAgentLLM({ messages });
    model = resp.model;

    // Record the assistant's turn (its text + any tool calls it requested).
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

    // No tool calls -> the model produced its final answer as plain text.
    if (resp.toolCalls.length === 0) {
      const parsed = parseRecommendation(resp.text);
      return {
        decision: parsed?.decision ?? 'ESCALATE',
        confidence: parsed?.confidence ?? 0,
        rationale: parsed?.rationale ?? `Could not parse recommendation: "${resp.text.slice(0, 200)}"`,
        toolCallTrace,
        turns: turn,
        model,
        completedAt: new Date().toISOString(),
      };
    }

    // Dispatch each requested tool as its own activity and feed results back.
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

  log.warn(`Agent hit MAX_TURNS (${MAX_TURNS}) without a final answer`);
  return {
    decision: 'ESCALATE',
    confidence: 0,
    rationale: `Agent reached ${MAX_TURNS} turns without submitting. A human should review.`,
    toolCallTrace,
    turns: MAX_TURNS,
    model,
    completedAt: new Date().toISOString(),
  };
}
