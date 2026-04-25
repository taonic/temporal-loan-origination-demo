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
  | 'APPRAISAL_ORDERED'
  | 'UNDERWRITTEN'
  | 'AGENT_REVIEWING'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'PENDING_FIX'
  | 'COMPENSATING'
  | 'ROLLBACK_PENDING_FIX'
  | 'ROLLED_BACK'
  | 'FAILED';

export type ActivityName =
  | 'verifyIncome'
  | 'runCreditCheck'
  | 'orderAppraisal'
  | 'underwrite'
  | 'agentReview'
  | 'humanApproval';

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
  // Set when the Vercel AI SDK rejected the model's tool call as invalid (e.g. missing
  // required arg). The workflow surfaces it back to the model on the next turn so it
  // can self-correct, instead of letting the activity throw and retry the same prompt.
  validationError?: {
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    message: string;
  };
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

export interface FixEntry {
  activity: string;
  field: string;
  oldValue: string;
  newValue: string;
  error: string;
}

export interface CompensationEntry {
  forwardActivity: string;
  compensationActivity: string;
  result: string;
}

export interface LoanState {
  status: LoanStatus;
  failedActivity: string;
  failureMessage: string;
  completedActivities: string[];
  compensatedActivities: string[];
  fixHistory: FixEntry[];
  compensationHistory: CompensationEntry[];
  application: LoanApplication;
  cancelReason: string;
  notificationMessage: string;
  agentRecommendation?: AgentRecommendation;
}

export interface RetryUpdate {
  key?: keyof LoanApplication | '';
  value?: string;
}

export interface CancelRequest {
  reason: string;
}
