import { generateText, tool, CoreMessage } from 'ai';
import { createOllama } from 'ollama-ai-provider';
import { z } from 'zod';
import type { AgentLLMResponse, AgentMessage } from './models';

const ollama = createOllama({
  baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/api',
});

const AGENT_MODEL = process.env.AGENT_MODEL || 'qwen2.5:1.5b';

// Tool schemas handed to the LLM. No `execute` — the workflow dispatches each
// tool call as its own activity so every step shows up in workflow history.
const AGENT_TOOL_SCHEMAS = {
  lookupFullCreditReport: tool({
    description:
      'Pull the full credit report for this applicant. Returns delinquencies, recent inquiries, revolving utilization, and credit history length.',
    parameters: z.object({
      applicationId: z.string(),
      ssn: z.string(),
    }),
  }),
  checkComplianceWatchlist: tool({
    description:
      'Run the applicant against OFAC / sanctions watchlists. Returns CLEAR or MATCH with details.',
    parameters: z.object({
      applicantName: z.string(),
      ssn: z.string(),
    }),
  }),
  getPropertyComparables: tool({
    description:
      'Fetch recent comparable property sales in the same zip code. Returns median comparable price and market trend.',
    parameters: z.object({
      propertyId: z.string(),
      propertyAddress: z.string(),
    }),
  }),
  submitRecommendation: tool({
    description:
      'Submit your final underwriting recommendation. Call exactly once when you have enough information. Always provide a rationale that cites the tool results you relied on.',
    parameters: z.object({
      decision: z.enum(['APPROVE', 'DECLINE', 'ESCALATE']),
      confidence: z.number().min(0).max(1),
      rationale: z.string(),
    }),
  }),
};

export async function callAgentLLM(params: {
  messages: AgentMessage[];
}): Promise<AgentLLMResponse> {
  const result = await generateText({
    model: ollama(AGENT_MODEL),
    messages: params.messages as CoreMessage[],
    tools: AGENT_TOOL_SCHEMAS,
    // maxSteps: 1 — prevent Vercel from auto-looping; the workflow drives the loop
    maxSteps: 1,
    temperature: 0,
  });
  return {
    text: result.text ?? '',
    toolCalls: result.toolCalls.map((tc) => ({
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      args: tc.args as Record<string, unknown>,
    })),
    finishReason: result.finishReason,
    model: AGENT_MODEL,
  };
}

// ---------- Mock tool implementations ----------
// Deterministic from inputs so the demo behaves predictably without a real DB.

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export async function lookupFullCreditReport(
  applicationId: string,
  ssn: string
): Promise<string> {
  const seed = hashSeed(ssn);
  const delinquencies = seed % 4; // 0–3 past delinquencies
  const inquiries = (seed >> 2) % 6; // 0–5 recent inquiries
  const utilization = 15 + ((seed >> 4) % 55); // 15–69% revolving utilization
  const historyYears = 3 + ((seed >> 6) % 20); // 3–22 years
  return JSON.stringify({
    applicationId,
    ssnSuffix: ssn.slice(-4),
    pastDelinquencies: delinquencies,
    recentInquiries: inquiries,
    revolvingUtilizationPct: utilization,
    creditHistoryYears: historyYears,
  });
}

export async function checkComplianceWatchlist(
  applicantName: string,
  ssn: string
): Promise<string> {
  // SSNs starting 999 already flag in underwrite() — mirror that logic here
  // so the agent sees the same compliance rule when it asks.
  if (ssn.startsWith('999')) {
    return JSON.stringify({
      status: 'MATCH',
      list: 'OFAC-SDN',
      subject: applicantName,
      details: 'Partial name + SSN range match — manual clearance required',
    });
  }
  return JSON.stringify({
    status: 'CLEAR',
    subject: applicantName,
    checkedLists: ['OFAC-SDN', 'FinCEN-314a', 'UK-HMT'],
  });
}

export async function getPropertyComparables(
  propertyId: string,
  propertyAddress: string
): Promise<string> {
  const seed = hashSeed(propertyId + propertyAddress);
  const medianComparable = 250000 + (seed % 500000); // $250k – $750k
  const trendPct = ((seed >> 8) % 20) - 5; // -5% .. +14% YoY
  return JSON.stringify({
    propertyId,
    propertyAddress,
    medianComparablePrice: medianComparable,
    yearOverYearTrendPct: trendPct,
    sampleSize: 6 + ((seed >> 12) % 10),
  });
}
