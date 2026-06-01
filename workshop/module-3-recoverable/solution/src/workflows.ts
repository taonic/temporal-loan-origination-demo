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

const { verifyIncome, runCreditCheck, underwrite } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 seconds',
});

export const getStateQuery = defineQuery<LoanState>('getState');
export const approvalSignal = defineSignal<[]>('approveApplication');
export const rejectSignal = defineSignal<[CancelRequest]>('rejectApplication');
// The retry signal carries a field patch to fix bad data.
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

  // The retry signal patches one field on the application, then unblocks the
  // recoverable step that's currently waiting.
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
      log.info(`Fix received ${key}: ${oldValue} -> ${update.value}`);
    }
    retryRequested = true;
  });

  const setStatus = (status: LoanStatus, activity = '', message = '') => {
    state.status = status;
    state.failedActivity = activity;
    state.failureMessage = message;
  };

  // The recoverable wrapper. Run an activity; if it throws (bad data), pause at
  // PENDING_FIX and wait for a `retry` signal to patch the data, then loop and
  // try again. The loan never fails outright — a human just nudges it forward.
  const recoverableStep = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    while (true) {
      try {
        return await fn();
      } catch (e: any) {
        const message = e.cause?.message || e.message || String(e);
        log.warn(`${name} failed: ${message}`);
        setStatus('PENDING_FIX', name, message);
        retryRequested = false;
        await condition(() => retryRequested);
        setStatus('STARTED');
        log.info(`Retrying ${name}`);
      }
    }
  };

  // The durable pipeline, now recoverable.
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

  // Human-in-the-loop approval.
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
