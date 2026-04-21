import { ApplicationFailure } from '@temporalio/activity';

// ---------- Forward activities ----------

export async function verifyIncome(
  applicantName: string,
  employerName: string,
  annualIncome: number
): Promise<string> {
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

export async function runCreditCheck(
  applicantName: string,
  ssn: string
): Promise<string> {
  if (ssn === '000-00-0000' || ssn.length < 11) {
    throw ApplicationFailure.nonRetryable(
      `Invalid SSN "${ssn}" for ${applicantName} — cannot pull credit report`
    );
  }
  return `Credit check passed for ${applicantName}: score 750`;
}

export async function orderAppraisal(
  propertyAddress: string,
  loanAmount: number
): Promise<string> {
  if (propertyAddress === '' || propertyAddress === 'INVALID_ADDRESS') {
    throw ApplicationFailure.nonRetryable(
      `Cannot order appraisal — invalid property address: "${propertyAddress}"`
    );
  }
  return `Appraisal completed for ${propertyAddress}: valued at $${loanAmount * 1.1}`;
}

export async function performTitleSearch(
  propertyId: string,
  propertyAddress: string
): Promise<string> {
  if (propertyId === '' || propertyId === 'MISSING') {
    throw ApplicationFailure.nonRetryable(
      `Title search failed — missing or invalid property ID: "${propertyId}" for ${propertyAddress}`
    );
  }
  return `Title is clear for property ${propertyId} at ${propertyAddress}`;
}

export async function underwrite(
  applicantName: string,
  ssn: string,
  annualIncome: number,
  loanAmount: number,
  downPayment: number
): Promise<string> {
  // Compliance block — SSNs starting with 999 simulate OFAC / sanctions hit.
  // Non-retryable with type 'RollbackRequired' tells the workflow to unwind the saga
  // instead of pausing for a human fix. There is no data correction that resolves this.
  if (ssn.startsWith('999')) {
    throw ApplicationFailure.nonRetryable(
      `Compliance block for ${applicantName}: OFAC/sanctions match on SSN ending ${ssn.slice(-4)}. Application must be withdrawn.`,
      'RollbackRequired'
    );
  }
  const dti = ((loanAmount - downPayment) / annualIncome) * 100;
  if (dti > 400) {
    throw ApplicationFailure.nonRetryable(
      `Underwriting denied for ${applicantName} — debt-to-income ratio ${dti.toFixed(0)}% exceeds 400% limit (loan: $${loanAmount}, income: $${annualIncome})`
    );
  }
  return `Underwriting approved for ${applicantName}: DTI ${dti.toFixed(0)}%`;
}

export async function closeLoan(
  applicationId: string,
  applicantName: string,
  loanAmount: number
): Promise<string> {
  return `Loan ${applicationId} closed for ${applicantName}: $${loanAmount} funded`;
}

// ---------- Compensation activities ----------
// Each compensation must be idempotent — the saga pattern registers them *before*
// the forward activity runs, so they may be invoked even when the forward side effect
// never fully landed. Running one twice must not corrupt state.

export async function withdrawCreditInquiry(
  applicationId: string,
  ssn: string
): Promise<string> {
  // Bureau APIs accept withdrawal requests multiple times — repeat calls are no-ops.
  return `Credit inquiry withdrawal filed for ${applicationId} (SSN ...${ssn.slice(-4)})`;
}

export async function cancelAppraisal(
  applicationId: string,
  propertyAddress: string
): Promise<string> {
  // Simulated external vendor outage. The operator can patch `propertyAddress`
  // (removing the APPRAISER_OFFLINE marker) via a retry signal to unblock.
  if (propertyAddress.includes('APPRAISER_OFFLINE')) {
    throw ApplicationFailure.nonRetryable(
      `Appraiser vendor unreachable for ${applicationId} at "${propertyAddress}" — retry once vendor is back or supply a new contact address`
    );
  }
  return `Appraisal cancelled for ${applicationId}: $50 cancellation fee retained, $450 refund issued`;
}

export async function releaseTitleHold(
  applicationId: string,
  propertyId: string
): Promise<string> {
  if (propertyId === 'LOCKED_TITLE') {
    throw ApplicationFailure.nonRetryable(
      `Title company rejected release for property ${propertyId} — supply a valid property ID to release the hold`
    );
  }
  return `Title hold released for ${applicationId} on property ${propertyId}`;
}

export async function releaseUnderwritingReservation(
  applicationId: string,
  loanAmount: number
): Promise<string> {
  return `Released $${loanAmount} underwriting capacity for ${applicationId}`;
}

export async function reverseLoanClosure(
  applicationId: string,
  loanAmount: number
): Promise<string> {
  return `Clawback initiated for ${applicationId}: $${loanAmount} funds recalled, lien release recorded`;
}

// Post-rollback notification — tells the applicant their application was cancelled.
// Runs through the recoverable wrapper so a transient email outage can be retried.
export async function notifyApplicantCancelled(
  applicationId: string,
  applicantName: string,
  reason: string
): Promise<string> {
  return `Cancellation notice sent to ${applicantName} for ${applicationId}: "${reason}"`;
}
