import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities';
import type { LoanApplication, LoanState } from './models';

// Re-export the agent child workflow so the worker registers it (used in Module 4).
export { underwritingAgentWorkflow } from './agent-workflow';

// `proxyActivities` turns your activity functions into stubs the workflow can
// call. Behind the scenes each call is scheduled on the task queue, run by a
// worker, and its result recorded in history.
const { verifyIncome, runCreditCheck, underwrite } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 seconds',
});

export async function homeLoanWorkflow(application: LoanApplication): Promise<LoanState> {
  // All user-visible state lives in one object.
  const state: LoanState = {
    status: 'STARTED',
    failedActivity: '',
    failureMessage: '',
    completedActivities: [],
    fixHistory: [],
    application: { ...application },
    rejectReason: '',
    agentRecommendation: undefined,
  };

  const app = state.application;

  // ===========================================================================
  // TODO(module-1): run the three activities in sequence.
  //
  //   1. await verifyIncome(app.applicantName, app.employerName, app.annualIncome)
  //      then: state.completedActivities.push('verifyIncome');
  //            state.status = 'INCOME_VERIFIED';
  //   2. await runCreditCheck(app.applicantName, app.ssn)
  //            -> 'runCreditCheck' / 'CREDIT_CHECKED'
  //   3. await underwrite(app.applicantName, app.annualIncome, app.loanAmount, app.downPayment)
  //            -> 'underwrite' / 'UNDERWRITTEN'
  //
  // Start the worker, start a workflow, and watch all three run in the Temporal
  // UI at http://localhost:8233. Then kill and restart the worker mid-run to see
  // the workflow resume exactly where it left off.
  // ===========================================================================

  // TODO(module-2): define a getState query + approve/reject signals, then after
  //                 underwriting block on PENDING_APPROVAL until one arrives.

  // TODO(module-3): wrap each activity in a recoverableStep() that pauses on
  //                 failure and waits for a `retry` signal to patch + retry.

  // TODO(module-4): run the AI underwriting agent as a child workflow here.

  return state;
}
