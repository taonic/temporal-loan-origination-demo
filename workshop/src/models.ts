// Shared types for the workshop. You don't edit this file.
// Some types (the Agent* ones) are only used starting in Module 4.

export interface LoanApplication {
  applicationId: string;
  applicantName: string;
  ssn: string;
  employerName: string;
  annualIncome: number;
  propertyAddress: string;
  propertyId: string;
  loanAmount: number;
  downPayment: number;
}

export type LoanStatus =
  | 'STARTED'
  | 'INCOME_VERIFIED'
  | 'CREDIT_CHECKED'
  | 'UNDERWRITTEN'
  | 'AGENT_REVIEWING'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'PENDING_FIX';

// A record of one human fix applied via the retry signal (Module 3).
export interface FixEntry {
  activity: string;
  field: string;
  oldValue: string;
  newValue: string;
  error: string;
}

// All user-visible workflow state lives here so the query handler and the
// final return can hand back one tidy object.
export interface LoanState {
  status: LoanStatus;
  failedActivity: string;
  failureMessage: string;
  completedActivities: string[];
  fixHistory: FixEntry[];
  application: LoanApplication;
  rejectReason: string;
  agentRecommendation?: AgentRecommendation;
}

// Payload of the `retry` signal (Module 3): which field to patch and its new value.
export interface RetryUpdate {
  key?: keyof LoanApplication | '';
  value?: string;
}

// ---------- Agent types (Module 4) ----------

export type AgentDecision = 'APPROVE' | 'DECLINE' | 'ESCALATE';

export interface AgentToolCall {
  tool: string;
  args: Record<string, unknown>;
  result: string;
}

export type AgentMessageContent =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: 'tool-result'; toolCallId: string; toolName: string; result: string };

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | AgentMessageContent[];
}

export interface AgentLLMResponse {
  text: string;
  toolCalls: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> }>;
  finishReason: string;
  model: string;
}

export interface AgentInput {
  application: LoanApplication;
  creditScore: number;
}

export interface AgentRecommendation {
  decision: AgentDecision;
  confidence: number;
  rationale: string;
  toolCallTrace: AgentToolCall[];
  turns: number;
  model: string;
  completedAt: string;
}
