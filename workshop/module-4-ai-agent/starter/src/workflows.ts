import {
  proxyActivities,
  defineSignal,
  defineQuery,
  setHandler,
  condition,
  log,
} from '@temporalio/workflow';
import type * as activities from './activities';
import type {
  CancelRequest,
  LoanApplication,
  LoanState,
  LoanStatus,
  RetryUpdate,
} from './models';

// Re-export the agent child workflow so the worker registers it.
export { underwritingAgentWorkflow } from './agent-workflow';

const { verifyIncome, runCreditCheck, underwrite } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 seconds',
});

export const getStateQuery = defineQuery<LoanState>('getState');
export const approvalSignal = defineSignal<[]>('approveApplication');
export const rejectSignal = defineSignal<[CancelRequest]>('rejectApplication');
export const retrySignal = defineSignal<[RetryUpdate]>('retry');

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
  let retryRequested = false;

  setHandler(getStateQuery, () => ({ ...state }));
  setHandler(approvalSignal, () => {
    approved = true;
  });
  setHandler(rejectSignal, (req: CancelRequest) => {
    rejected = true;
    state.rejectReason = req.reason || 'No reason provided';
  });
  setHandler(retrySignal, (update: RetryUpdate) => {
    if (update.key) {
      const key = update.key as keyof LoanApplication;
      const oldValue = String(app[key]);
      if (key === 'annualIncome' || key === 'loanAmount' || key === 'downPayment') {
        (app[key] as number) = parseFloat(update.value ?? '0');
      } else {
        (app[key] as string) = update.value ?? '';
      }
      state.fixHistory.push({
        activity: state.failedActivity,
        field: key,
        oldValue,
        newValue: update.value ?? '',
        error: state.failureMessage,
      });
    }
    retryRequested = true;
  });

  const setStatus = (status: LoanStatus, activity = '', message = '') => {
    state.status = status;
    state.failedActivity = activity;
    state.failureMessage = message;
  };

  const recoverableStep = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    while (true) {
      try {
        return await fn();
      } catch (e: any) {
        const message = e.cause?.message || e.message || String(e);
        setStatus('PENDING_FIX', name, message);
        retryRequested = false;
        await condition(() => retryRequested);
        setStatus('STARTED');
      }
    }
  };

  await recoverableStep('verifyIncome', () =>
    verifyIncome(app.applicantName, app.employerName, app.annualIncome)
  );
  state.completedActivities.push('verifyIncome');
  setStatus('INCOME_VERIFIED');

  await recoverableStep('runCreditCheck', () => runCreditCheck(app.applicantName, app.ssn));
  state.completedActivities.push('runCreditCheck');
  setStatus('CREDIT_CHECKED');

  await recoverableStep('underwrite', () =>
    underwrite(app.applicantName, app.annualIncome, app.loanAmount, app.downPayment)
  );
  state.completedActivities.push('underwrite');
  setStatus('UNDERWRITTEN');

  // ===========================================================================
  // TODO: run the AI underwriting agent as a child workflow here, before approval.
  //
  //   1. Import executeChild and underwritingAgentWorkflow:
  //        import { executeChild } from '@temporalio/workflow';
  //        import { underwritingAgentWorkflow } from './agent-workflow';
  //   2. setStatus('AGENT_REVIEWING'); then:
  //        state.agentRecommendation = await executeChild(underwritingAgentWorkflow, {
  //          workflowId: `${app.applicationId}-agent`,
  //          args: [{ application: { ...app }, creditScore: 750 }],
  //        });
  //   3. Wrap it in try/catch so an Ollama outage records an ESCALATE
  //      recommendation instead of crashing the loan.
  //   4. state.completedActivities.push('agentReview'); setStatus('UNDERWRITTEN');
  //
  // Implement the agent's tool-call loop in agent-workflow.ts as well.
  // ===========================================================================

  setStatus('PENDING_APPROVAL');
  await condition(() => approved || rejected);

  if (rejected) {
    setStatus('REJECTED');
  } else {
    state.completedActivities.push('humanApproval');
    setStatus('APPROVED');
  }

  return state;
}
