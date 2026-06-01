import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities';
import type { LoanApplication, LoanState } from './models';

const { verifyIncome, runCreditCheck, underwrite } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 seconds',
});

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

  // The durable pipeline.
  await verifyIncome(app.applicantName, app.employerName, app.annualIncome);
  state.completedActivities.push('verifyIncome');
  state.status = 'INCOME_VERIFIED';

  await runCreditCheck(app.applicantName, app.ssn);
  state.completedActivities.push('runCreditCheck');
  state.status = 'CREDIT_CHECKED';

  await underwrite(app.applicantName, app.annualIncome, app.loanAmount, app.downPayment);
  state.completedActivities.push('underwrite');
  state.status = 'UNDERWRITTEN';

  // ===========================================================================
  // TODO: add human-in-the-loop approval.
  //
  //   1. At module scope (outside the function), define:
  //        export const getStateQuery = defineQuery<LoanState>('getState');
  //        export const approvalSignal = defineSignal<[]>('approveApplication');
  //        export const rejectSignal = defineSignal<[CancelRequest]>('rejectApplication');
  //   2. Inside the function, track `let approved = false; let rejected = false;`
  //      and attach handlers with setHandler (query returns { ...state };
  //      signals flip the flags; reject stores req.reason on state.rejectReason).
  //   3. Here, set status 'PENDING_APPROVAL' and block:
  //        await condition(() => approved || rejected);
  //   4. On approve -> status 'APPROVED'; on reject -> status 'REJECTED'.
  //
  // You'll also need to import defineQuery, defineSignal, setHandler, condition
  // from '@temporalio/workflow' and CancelRequest from './models'.
  // ===========================================================================

  return state;
}
