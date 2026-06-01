import { ApplicationFailure } from '@temporalio/activity';

// Activities are where side effects and non-deterministic work live (network
// calls, DB writes, reading the clock). Temporal records each activity's result
// in history so the workflow can be replayed deterministically.
//
// These three are already written for you. Each one validates its inputs and
// throws ApplicationFailure.nonRetryable() on bad data.

// A small delay so the pipeline is observable in the Temporal UI.
const SIMULATED_PROCESSING_MS = 2500;
const simulateProcessing = () =>
  new Promise<void>((resolve) => setTimeout(resolve, SIMULATED_PROCESSING_MS));

export async function verifyIncome(
  applicantName: string,
  employerName: string,
  annualIncome: number
): Promise<string> {
  await simulateProcessing();
  if (employerName === 'UNKNOWN_EMPLOYER') {
    throw ApplicationFailure.nonRetryable(
      `Employer "${employerName}" not found in verification database for ${applicantName}`
    );
  }
  if (annualIncome <= 0) {
    throw ApplicationFailure.nonRetryable(
      `Invalid annual income: $${annualIncome} for ${applicantName}`
    );
  }
  return `Income verified: ${applicantName} earns $${annualIncome}/yr at ${employerName}`;
}

export async function runCreditCheck(applicantName: string, ssn: string): Promise<string> {
  await simulateProcessing();
  // A malformed SSN can't be used to pull a credit report.
  if (ssn === '000-00-0000' || ssn.length < 11) {
    throw ApplicationFailure.nonRetryable(
      `Invalid SSN "${ssn}" for ${applicantName} — cannot pull credit report`
    );
  }
  return `Credit check passed for ${applicantName}: score 750`;
}

export async function underwrite(
  applicantName: string,
  annualIncome: number,
  loanAmount: number,
  downPayment: number
): Promise<string> {
  await simulateProcessing();
  const dti = ((loanAmount - downPayment) / annualIncome) * 100;
  if (dti > 400) {
    throw ApplicationFailure.nonRetryable(
      `Underwriting denied for ${applicantName} — debt-to-income ratio ${dti.toFixed(0)}% exceeds 400% limit`
    );
  }
  return `Underwriting approved for ${applicantName}: DTI ${dti.toFixed(0)}%`;
}
