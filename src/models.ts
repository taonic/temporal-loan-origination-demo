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
  | 'CLOSED'
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
  | 'closeLoan';

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
}

export interface RetryUpdate {
  key?: keyof LoanApplication | '';
  value?: string;
}

export interface CancelRequest {
  reason: string;
}
