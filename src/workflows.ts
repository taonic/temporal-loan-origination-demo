import {
  proxyActivities,
  defineSignal,
  defineQuery,
  setHandler,
  condition,
  executeChild,
  isCancellation,
  CancellationScope,
  upsertSearchAttributes,
  log,
} from '@temporalio/workflow';
import { defineSearchAttributeKey } from '@temporalio/common';
import type * as activities from './activities';
import { underwritingAgentWorkflow } from './agent-workflow';
import type {
  CancelRequest,
  LoanApplication,
  LoanState,
  LoanStatus,
  RetryUpdate,
} from './models';

const LoanStatusKey = defineSearchAttributeKey('LoanStatus', 'KEYWORD');
const FailedActivityKey = defineSearchAttributeKey('FailedActivity', 'KEYWORD');

const {
  verifyIncome,
  runCreditCheck,
  orderAppraisal,
  underwrite,
  withdrawCreditInquiry,
  cancelAppraisal,
  releaseUnderwritingReservation,
  notifyApplicantCancelled,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 seconds',
});

export { underwritingAgentWorkflow } from './agent-workflow';

export const retrySignal = defineSignal<[RetryUpdate]>('retry');
export const cancelSignal = defineSignal<[CancelRequest]>('cancelApplication');
export const approvalSignal = defineSignal<[]>('approveApplication');
export const getStateQuery = defineQuery<LoanState>('getState');

interface Compensation {
  forwardActivity: string;
  compensationActivity: string;
  run: () => Promise<string>;
}

export async function homeLoanWorkflow(application: LoanApplication): Promise<LoanState> {
  // All user-visible / queryable loan state lives in one object so the query
  // handler and final return can return a defensive snapshot trivially.
  const state: LoanState = {
    status: 'STARTED',
    failedActivity: '',
    failureMessage: '',
    completedActivities: [],
    compensatedActivities: [],
    fixHistory: [],
    compensationHistory: [],
    application: { ...application },
    cancelReason: '',
    notificationMessage: '',
    agentRecommendation: undefined,
  };

  // Coordination flags — transient control flow, not part of the persisted loan state.
  let retryRequested = false;
  let cancelRequested = false;
  let approvalRequested = false;

  // Scope that wraps the agent child execution so a cancel signal can propagate
  // cancellation into the running child mid-flight (not only on the next tool-call boundary).
  let agentScope: CancellationScope | undefined;

  // LIFO compensation stack — unshift on registration, iterate head-first to unwind
  const compensations: Compensation[] = [];

  const snapshot = (): LoanState => ({
    ...state,
    application: { ...state.application },
    completedActivities: [...state.completedActivities],
    compensatedActivities: [...state.compensatedActivities],
    fixHistory: [...state.fixHistory],
    compensationHistory: [...state.compensationHistory],
  });

  const updateStatus = (newStatus: LoanStatus, activity = '', message = '') => {
    state.status = newStatus;
    state.failedActivity = activity;
    state.failureMessage = message;
    upsertSearchAttributes([
      { key: LoanStatusKey, value: newStatus },
      { key: FailedActivityKey, value: activity },
    ]);
  };

  setHandler(getStateQuery, snapshot);

  setHandler(retrySignal, (update: RetryUpdate) => {
    if (update.key) {
      const key = update.key as keyof LoanApplication;
      const oldValue = String((state.application as any)[key]);
      if (key === 'annualIncome' || key === 'loanAmount' || key === 'downPayment') {
        (state.application as any)[key] = parseFloat(update.value ?? '0');
      } else {
        (state.application as any)[key] = update.value ?? '';
      }
      state.fixHistory.push({
        activity: state.failedActivity,
        field: key,
        oldValue,
        newValue: update.value ?? '',
        error: state.failureMessage,
      });
      log.info(`Fix received ${key}: ${oldValue} -> ${update.value}`);
    } else {
      log.info('Retry requested without patch');
    }
    retryRequested = true;
  });

  setHandler(approvalSignal, () => {
    approvalRequested = true;
    log.info('Human approval received');
  });

  setHandler(cancelSignal, (req: CancelRequest) => {
    if (state.status === 'COMPENSATING' || state.status === 'ROLLED_BACK' || state.status === 'ROLLBACK_PENDING_FIX') {
      log.warn('Cancel signal ignored — rollback already in progress');
      return;
    }
    if (state.status === 'APPROVED' || state.status === 'REJECTED') {
      log.warn('Cancel signal ignored — workflow already finalized');
      return;
    }
    cancelRequested = true;
    state.cancelReason = req.reason || 'No reason provided';
    log.info(`Cancel requested: ${state.cancelReason}`);
    retryRequested = true;
    // If the agent child is running, propagate cancellation into it so executeChild
    // returns immediately instead of waiting for the next turn to notice the flag.
    agentScope?.cancel();
  });

  // Recoverable wrapper shared by forward and compensation phases.
  // Forward: on failure, pause with PENDING_FIX and await retry signal (or cancel).
  // Compensation: on failure, pause with ROLLBACK_PENDING_FIX and await retry signal.
  const recoverableStep = async <T>(
    displayName: string,
    fn: () => Promise<T>,
    phase: 'forward' | 'compensation'
  ): Promise<T> => {
    const pendingStatus: LoanStatus = phase === 'forward' ? 'PENDING_FIX' : 'ROLLBACK_PENDING_FIX';
    const resumeStatus: LoanStatus = phase === 'forward' ? 'STARTED' : 'COMPENSATING';
    while (true) {
      try {
        return await fn();
      } catch (e: any) {
        const message = e.cause?.message || e.message || String(e);
        const type = e.cause?.type || e.type;
        // RollbackRequired in forward phase aborts the pipeline to run saga compensations
        if (phase === 'forward' && type === 'RollbackRequired') {
          cancelRequested = true;
          state.cancelReason = message;
          throw e;
        }
        log.warn(`${phase} ${displayName} failed: ${message}`);
        updateStatus(pendingStatus, displayName, message);
        retryRequested = false;
        await condition(() => retryRequested);
        if (phase === 'forward' && cancelRequested) {
          throw new Error(`Cancelled during ${displayName}: ${state.cancelReason}`);
        }
        updateStatus(resumeStatus, '', '');
        log.info(`Retrying ${phase} ${displayName}`);
      }
    }
  };

  // Run a forward step and register its compensation BEFORE execution (saga best practice).
  // Registering before handles partial side effects if the activity fails mid-flight.
  const runForward = async <T>(
    activityName: string,
    forward: () => Promise<T>,
    compensation?: { name: string; fn: () => Promise<string> }
  ): Promise<T> => {
    if (cancelRequested) {
      throw new Error(`Cancelled before ${activityName}: ${state.cancelReason}`);
    }
    if (compensation) {
      compensations.unshift({
        forwardActivity: activityName,
        compensationActivity: compensation.name,
        run: compensation.fn,
      });
    }
    return recoverableStep(activityName, forward, 'forward');
  };

  // Forward pipeline aborted — unwind the saga in LIFO order.
  // The caller wraps this in CancellationScope.nonCancellable so that even if the parent
  // workflow itself was cancelled (CancelledFailure propagated into the catch block via
  // a child cancel or a Temporal cancel of the parent), compensation activities still run
  // to completion instead of being aborted mid-unwind.
  const runSagaUnwind = async (err: any): Promise<void> => {
    const app = state.application;
    const trigger = state.cancelReason || err.message || String(err);
    log.warn(`Forward pipeline aborted: ${trigger} — running saga compensations`);
    updateStatus('COMPENSATING', '', trigger);

    for (const comp of compensations) {
      // Skip compensations whose forward activity never completed — idempotency
      // means calling them would also be safe, but skipping avoids noise in the history
      if (!state.completedActivities.includes(comp.forwardActivity)) {
        log.info(`Skipping ${comp.compensationActivity}: ${comp.forwardActivity} never completed`);
        continue;
      }
      const result = await recoverableStep(
        comp.forwardActivity,
        comp.run,
        'compensation'
      );
      state.compensationHistory.push({
        forwardActivity: comp.forwardActivity,
        compensationActivity: comp.compensationActivity,
        result,
      });
      state.compensatedActivities.push(comp.forwardActivity);
      updateStatus('COMPENSATING');
    }

    // After side effects are unwound, notify the applicant that the application was cancelled.
    // Run through the recoverable wrapper so a transient email outage pauses rather than crashes.
    state.notificationMessage = await recoverableStep(
      'notifyApplicantCancelled',
      () => notifyApplicantCancelled(app.applicationId, app.applicantName, trigger),
      'compensation'
    );

    updateStatus('ROLLED_BACK', '', trigger);
  };

  // Forward pipeline — the four side-effecting business activities, each with its
  // compensation registered before execution. Status transitions in lockstep.
  const runForwardPipeline = async (): Promise<void> => {
    const app = state.application;

    await runForward(
      'verifyIncome',
      () => verifyIncome(app.applicantName, app.employerName, app.annualIncome), // Forward
      // Compensation: none. No external state to undo, so no entry is pushed to the saga stack.
    );
    state.completedActivities.push('verifyIncome');
    updateStatus('INCOME_VERIFIED');

    await runForward(
      'runCreditCheck',
      () => runCreditCheck(app.applicantName, app.ssn), // Forward
      { name: 'withdrawCreditInquiry', fn: () => withdrawCreditInquiry(app.applicationId, app.ssn) } // Compensation
    );
    state.completedActivities.push('runCreditCheck');
    updateStatus('CREDIT_CHECKED');

    await runForward(
      'orderAppraisal',
      () => orderAppraisal(app.propertyAddress, app.loanAmount), // Forward
      { name: 'cancelAppraisal', fn: () => cancelAppraisal(app.applicationId, app.propertyAddress) } // Compensation
    );
    state.completedActivities.push('orderAppraisal');
    updateStatus('APPRAISAL_ORDERED');

    await runForward(
      'underwrite',
      () => underwrite(app.applicantName, app.ssn, app.annualIncome, app.loanAmount, app.downPayment), // Forward
      {
        name: 'releaseUnderwritingReservation',
        fn: () => releaseUnderwritingReservation(app.applicationId, app.loanAmount),
      } // Compensation
    );
    state.completedActivities.push('underwrite');
    updateStatus('UNDERWRITTEN');
  };

  // Agentic AI underwriter — runs as a child workflow so its tool-call loop
  // gets its own history, can continue-as-new, and is inspectable in the
  // Temporal UI as a self-contained execution. Read-only: no compensation.
  const runAgentReview = async (): Promise<void> => {
    const app = state.application;
    updateStatus('AGENT_REVIEWING');
    try {
      // Run the child inside a dedicated cancellable scope. The cancelSignal handler
      // calls `agentScope.cancel()` to interrupt the child mid-flight; external cancellation
      // of the child (via Temporal UI) also surfaces here as a CancelledFailure.
      state.agentRecommendation = await CancellationScope.cancellable(async () => {
        agentScope = CancellationScope.current();
        return executeChild(underwritingAgentWorkflow, {
          workflowId: `${app.applicationId}-agent`,
          args: [{ application: { ...app }, creditScore: 750 }],
        });
      });
      log.info(
        `Agent recommendation: ${state.agentRecommendation.decision} (confidence ${state.agentRecommendation.confidence})`
      );
    } catch (err: any) {
      // Either the operator cancelled the agent child directly (Temporal UI) or a cancel
      // signal on the parent propagated down via agentScope.cancel(). In both cases, treat
      // as a cancel of the whole application and fall through to the saga unwind.
      if (isCancellation(err)) {
        log.warn('Agent child was cancelled — cancelling loan application');
        if (!cancelRequested) {
          cancelRequested = true;
          state.cancelReason = 'Agent child workflow cancelled by operator';
        }
        throw err;
      }
      // Agent unavailable (e.g. Ollama down) — record as ESCALATE so the
      // human approver still sees something meaningful instead of a crash.
      log.warn(`Agent child failed: ${err.message || err}`);
      state.agentRecommendation = {
        decision: 'ESCALATE',
        confidence: 0,
        rationale: `Agent unavailable: ${err.message || String(err)}. Human review required.`,
        toolCallTrace: [],
        turns: 0,
        model: 'unavailable',
        completedAt: new Date().toISOString(),
      };
    }
    state.completedActivities.push('agentReview');
    updateStatus('UNDERWRITTEN');
  };

  // Final step: human-in-the-loop approval. Block until an operator approves
  // (fund the loan) or rejects (notify applicant, end as REJECTED).
  const awaitHumanApproval = async (): Promise<void> => {
    const app = state.application;
    updateStatus('PENDING_APPROVAL');
    await condition(() => approvalRequested || cancelRequested);
    if (cancelRequested) {
      // Human reject at approval: no saga unwind — earlier holds (credit, appraisal,
      // underwriting reservation) stay committed per business policy. Just notify and end.
      state.notificationMessage = await notifyApplicantCancelled(
        app.applicationId,
        app.applicantName,
        state.cancelReason
      );
      updateStatus('REJECTED', '', state.cancelReason);
    } else {
      state.completedActivities.push('humanApproval');
      updateStatus('APPROVED');
    }
  };

  // Main workflow logic: run the forward pipeline, 
  // then the agent review, then await human approval.
  // If any step throws, run the saga unwind in a non-cancellable scope 
  // to ensure compensations complete even if the workflow was 
  // externally cancelled.
  try {
    updateStatus('STARTED');
    await runForwardPipeline();
    await runAgentReview();
    await awaitHumanApproval();
  } catch (err: any) {
    await CancellationScope.nonCancellable(() => runSagaUnwind(err));
  }

  return snapshot();
}
