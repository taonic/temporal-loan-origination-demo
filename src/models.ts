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
  | 'TITLE_SEARCHED'
  | 'UNDERWRITTEN'
  | 'AGENT_REVIEWING'
  | 'CLOSED'
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
  | 'performTitleSearch'
  | 'underwrite'
  | 'agentReview'
  | 'closeLoan'
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
