import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities';
import type { LoanApplication, LoanState } from './models';

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

  // The durable pipeline. Each `await` is a durable checkpoint: if the worker
  // dies between steps, a restarted worker replays history and resumes here.

  await verifyIncome(app.applicantName, app.employerName, app.annualIncome);
  state.completedActivities.push('verifyIncome');
  state.status = 'INCOME_VERIFIED';

  await runCreditCheck(app.applicantName, app.ssn);
  state.completedActivities.push('runCreditCheck');
  state.status = 'CREDIT_CHECKED';

  await underwrite(app.applicantName, app.annualIncome, app.loanAmount, app.downPayment);
  state.completedActivities.push('underwrite');
  state.status = 'UNDERWRITTEN';

  return state;
}
