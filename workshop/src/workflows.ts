import {
  proxyActivities,
  defineSignal,
  defineQuery,
  setHandler,
  condition,
  log,
} from '@temporalio/workflow';
import type * as activities from './activities';
import type { CancelRequest, LoanApplication, LoanState } from './models';

// Re-export the agent child workflow so the worker registers it (used in Module 4).
export { underwritingAgentWorkflow } from './agent-workflow';

const { verifyIncome, runCreditCheck, underwrite } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 seconds',
});

// --- Module 2: signals & queries --------------------------------------------
// A query is a read-only peek at state. A signal is an async message that drives
// the workflow forward. Define them once, attach handlers inside the workflow.
export const getStateQuery = defineQuery<LoanState>('getState');
export const approvalSignal = defineSignal<[]>('approveApplication');
export const rejectSignal = defineSignal<[CancelRequest]>('rejectApplication');

export async function homeLoanWorkflow(application: LoanApplication): Promise<LoanState> {
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

  // Control-flow flags driven by signals — not part of the persisted loan state.
  let approved = false;
  let rejected = false;

  // The query handler returns a defensive snapshot of state on demand.
  setHandler(getStateQuery, () => ({ ...state }));

  setHandler(approvalSignal, () => {
    approved = true;
    log.info('Approval signal received');
  });

  setHandler(rejectSignal, (req: CancelRequest) => {
    rejected = true;
    state.rejectReason = req.reason || 'No reason provided';
    log.info(`Reject signal received: ${state.rejectReason}`);
  });

  // --- Module 1: the durable pipeline -----------------------------------------
  await verifyIncome(app.applicantName, app.employerName, app.annualIncome);
  state.completedActivities.push('verifyIncome');
  state.status = 'INCOME_VERIFIED';

  await runCreditCheck(app.applicantName, app.ssn);
  state.completedActivities.push('runCreditCheck');
  state.status = 'CREDIT_CHECKED';

  await underwrite(app.applicantName, app.annualIncome, app.loanAmount, app.downPayment);
  state.completedActivities.push('underwrite');
  state.status = 'UNDERWRITTEN';

  // --- Module 2: human-in-the-loop approval -----------------------------------
  // Block until an operator signals. `condition` suspends the workflow (durably,
  // for as long as it takes — minutes or months) until the predicate is true.
  state.status = 'PENDING_APPROVAL';
  await condition(() => approved || rejected);

  if (rejected) {
    state.status = 'REJECTED';
  } else {
    state.completedActivities.push('humanApproval');
    state.status = 'APPROVED';
  }

  // TODO(module-3): wrap each activity in a recoverableStep() that pauses on
  //                 failure and waits for a `retry` signal to patch + retry.

  // TODO(module-4): run the AI underwriting agent as a child workflow before approval.

  return state;
}
