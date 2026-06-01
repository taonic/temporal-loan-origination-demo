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

const { verifyIncome, runCreditCheck, underwrite } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 seconds',
});

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

  let approved = false;
  let rejected = false;

  setHandler(getStateQuery, () => ({ ...state }));
  setHandler(approvalSignal, () => {
    approved = true;
  });
  setHandler(rejectSignal, (req: CancelRequest) => {
    rejected = true;
    state.rejectReason = req.reason || 'No reason provided';
  });

  // ===========================================================================
  // TODO: make the pipeline recoverable.
  //
  //   1. Add a `let retryRequested = false;` flag and a `retry` signal:
  //        export const retrySignal = defineSignal<[RetryUpdate]>('retry');
  //      Its handler patches one field on `app` (parse numbers for annualIncome /
  //      loanAmount / downPayment), pushes a FixEntry onto state.fixHistory, and
  //      sets retryRequested = true.
  //   2. Write a helper:
  //        const recoverableStep = async <T>(name: string, fn: () => Promise<T>) => {
  //          while (true) {
  //            try { return await fn(); }
  //            catch (e) {
  //              // status PENDING_FIX, record name + message
  //              retryRequested = false;
  //              await condition(() => retryRequested);
  //              // status back to STARTED, then loop to retry
  //            }
  //          }
  //        };
  //   3. Wrap each activity call below in recoverableStep('name', () => activity(...)).
  //
  // Import RetryUpdate and LoanStatus from './models' as needed.
  // ===========================================================================

  await verifyIncome(app.applicantName, app.employerName, app.annualIncome);
  state.completedActivities.push('verifyIncome');
  state.status = 'INCOME_VERIFIED';

  await runCreditCheck(app.applicantName, app.ssn);
  state.completedActivities.push('runCreditCheck');
  state.status = 'CREDIT_CHECKED';

  await underwrite(app.applicantName, app.annualIncome, app.loanAmount, app.downPayment);
  state.completedActivities.push('underwrite');
  state.status = 'UNDERWRITTEN';

  state.status = 'PENDING_APPROVAL';
  await condition(() => approved || rejected);

  if (rejected) {
    state.status = 'REJECTED';
  } else {
    state.completedActivities.push('humanApproval');
    state.status = 'APPROVED';
  }

  return state;
}
