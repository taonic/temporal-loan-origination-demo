import {
  proxyActivities,
  defineSignal,
  defineQuery,
  setHandler,
  condition,
  executeChild,
  upsertSearchAttributes,
  log,
} from '@temporalio/workflow';
import { defineSearchAttributeKey } from '@temporalio/common';
import type * as activities from './activities';
import { underwritingAgentWorkflow } from './agent-workflow';
import type {
  AgentRecommendation,
  CancelRequest,
  CompensationEntry,
  FixEntry,
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
  performTitleSearch,
  underwrite,
  closeLoan,
  withdrawCreditInquiry,
  cancelAppraisal,
  releaseTitleHold,
  releaseUnderwritingReservation,
  reverseLoanClosure,
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
  const app = { ...application };
  let status: LoanStatus = 'STARTED';
  let failedActivity = '';
  let failureMessage = '';
  let retryRequested = false;
  let cancelRequested = false;
  let approvalRequested = false;
  let cancelReason = '';
  let notificationMessage = '';
  const completedActivities: string[] = [];
  const compensatedActivities: string[] = [];
  const fixHistory: FixEntry[] = [];
  const compensationHistory: CompensationEntry[] = [];
  let agentRecommendation: AgentRecommendation | undefined;

  // LIFO compensation stack — unshift on registration, iterate head-first to unwind
  const compensations: Compensation[] = [];

  const updateStatus = (newStatus: LoanStatus, activity = '', message = '') => {
    status = newStatus;
    failedActivity = activity;
    failureMessage = message;
    upsertSearchAttributes([
      { key: LoanStatusKey, value: newStatus },
      { key: FailedActivityKey, value: activity },
    ]);
  };

  setHandler(getStateQuery, () => ({
    status,
    failedActivity,
    failureMessage,
    completedActivities: [...completedActivities],
    compensatedActivities: [...compensatedActivities],
    fixHistory: [...fixHistory],
    compensationHistory: [...compensationHistory],
    application: { ...app },
    cancelReason,
    notificationMessage,
    agentRecommendation,
  }));

  setHandler(retrySignal, (update: RetryUpdate) => {
    if (update.key) {
      const key = update.key as keyof LoanApplication;
      const oldValue = String((app as any)[key]);
      if (key === 'annualIncome' || key === 'loanAmount' || key === 'downPayment') {
        (app as any)[key] = parseFloat(update.value ?? '0');
      } else {
        (app as any)[key] = update.value ?? '';
      }
      fixHistory.push({
        activity: failedActivity,
        field: key,
        oldValue,
        newValue: update.value ?? '',
        error: failureMessage,
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
    if (status === 'COMPENSATING' || status === 'ROLLED_BACK' || status === 'ROLLBACK_PENDING_FIX') {
      log.warn('Cancel signal ignored — rollback already in progress');
      return;
    }
    if (status === 'CLOSED') {
      log.warn('Cancel signal ignored — loan already closed');
      return;
    }
    cancelRequested = true;
    cancelReason = req.reason || 'No reason provided';
    log.info(`Cancel requested: ${cancelReason}`);
    retryRequested = true;
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
          cancelReason = message;
          throw e;
        }
        log.warn(`${phase} ${displayName} failed: ${message}`);
        updateStatus(pendingStatus, displayName, message);
        retryRequested = false;
        await condition(() => retryRequested);
        if (phase === 'forward' && cancelRequested) {
          throw new Error(`Cancelled during ${displayName}: ${cancelReason}`);
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
      throw new Error(`Cancelled before ${activityName}: ${cancelReason}`);
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

  try {
    updateStatus('STARTED');

    await runForward(
      'verifyIncome',
      () => verifyIncome(app.applicantName, app.employerName, app.annualIncome), // Forward
      // Compensation: none. No external state to undo, so no entry is pushed to the saga stack.
    );
    completedActivities.push('verifyIncome');
    updateStatus('INCOME_VERIFIED');

    await runForward(
      'runCreditCheck',
      () => runCreditCheck(app.applicantName, app.ssn), // Forward
      { name: 'withdrawCreditInquiry', fn: () => withdrawCreditInquiry(app.applicationId, app.ssn) } // Compensation
    );
    completedActivities.push('runCreditCheck');
    updateStatus('CREDIT_CHECKED');

    await runForward(
      'orderAppraisal',
      () => orderAppraisal(app.propertyAddress, app.loanAmount), // Forward
      { name: 'cancelAppraisal', fn: () => cancelAppraisal(app.applicationId, app.propertyAddress) } // Compensation
    );
    completedActivities.push('orderAppraisal');
    updateStatus('APPRAISAL_ORDERED');

    await runForward(
      'performTitleSearch',
      () => performTitleSearch(app.propertyId, app.propertyAddress), // Forward
      { name: 'releaseTitleHold', fn: () => releaseTitleHold(app.applicationId, app.propertyId) } // Compensation
    );
    completedActivities.push('performTitleSearch');
    updateStatus('TITLE_SEARCHED');

    await runForward(
      'underwrite',
      () => underwrite(app.applicantName, app.ssn, app.annualIncome, app.loanAmount, app.downPayment), // Forward
      {
        name: 'releaseUnderwritingReservation',
        fn: () => releaseUnderwritingReservation(app.applicationId, app.loanAmount),
      } // Compensation
    );
    completedActivities.push('underwrite');
    updateStatus('UNDERWRITTEN');

    // Agentic AI underwriter — runs as a child workflow so its tool-call loop
    // gets its own history, can continue-as-new, and is inspectable in the
    // Temporal UI as a self-contained execution. Read-only: no compensation.
    updateStatus('AGENT_REVIEWING');
    try {
      agentRecommendation = await executeChild(underwritingAgentWorkflow, {
        workflowId: `${app.applicationId}-agent`,
        args: [{ application: { ...app }, creditScore: 750 }],
      });
      log.info(
        `Agent recommendation: ${agentRecommendation.decision} (confidence ${agentRecommendation.confidence})`
      );
    } catch (err: any) {
      // Agent unavailable (e.g. Ollama down) — record as ESCALATE so the
      // human approver still sees something meaningful instead of a crash.
      log.warn(`Agent child failed: ${err.message || err}`);
      agentRecommendation = {
        decision: 'ESCALATE',
        confidence: 0,
        rationale: `Agent unavailable: ${err.message || String(err)}. Human review required.`,
        toolCallTrace: [],
        turns: 0,
        model: 'unavailable',
        completedAt: new Date().toISOString(),
      };
    }
    completedActivities.push('agentReview');
    updateStatus('UNDERWRITTEN');

    await runForward(
      'closeLoan',
      () => closeLoan(app.applicationId, app.applicantName, app.loanAmount), // Forward
      { name: 'reverseLoanClosure', fn: () => reverseLoanClosure(app.applicationId, app.loanAmount) } // Compensation
    );
    completedActivities.push('closeLoan');
    updateStatus('CLOSED');

    // Final step: human-in-the-loop approval. Pause and wait for an operator
    // to either approve (proceed) or reject (notify applicant, end as REJECTED).
    updateStatus('PENDING_APPROVAL');
    await condition(() => approvalRequested || cancelRequested);
    if (cancelRequested) {
      // Human reject at approval: no saga unwind — closeLoan and earlier steps
      // stay committed per business policy. Just notify the applicant and end.
      notificationMessage = await notifyApplicantCancelled(
        app.applicationId,
        app.applicantName,
        cancelReason
      );
      updateStatus('REJECTED', '', cancelReason);
    } else {
      completedActivities.push('humanApproval');
      updateStatus('APPROVED');
    }
  } catch (err: any) {
    // Forward pipeline aborted — unwind the saga in LIFO order
    const trigger = cancelReason || err.message || String(err);
    log.warn(`Forward pipeline aborted: ${trigger} — running saga compensations`);
    updateStatus('COMPENSATING', '', trigger);

    for (const comp of compensations) {
      // Skip compensations whose forward activity never completed — idempotency
      // means calling them would also be safe, but skipping avoids noise in the history
      if (!completedActivities.includes(comp.forwardActivity)) {
        log.info(`Skipping ${comp.compensationActivity}: ${comp.forwardActivity} never completed`);
        continue;
      }
      const result = await recoverableStep(
        comp.forwardActivity,
        comp.run,
        'compensation'
      );
      compensationHistory.push({
        forwardActivity: comp.forwardActivity,
        compensationActivity: comp.compensationActivity,
        result,
      });
      compensatedActivities.push(comp.forwardActivity);
      updateStatus('COMPENSATING');
    }

    // After side effects are unwound, notify the applicant that the application was cancelled.
    // Run through the recoverable wrapper so a transient email outage pauses rather than crashes.
    notificationMessage = await recoverableStep(
      'notifyApplicantCancelled',
      () => notifyApplicantCancelled(app.applicationId, app.applicantName, trigger),
      'compensation'
    );

    updateStatus('ROLLED_BACK', '', trigger);
  }

  return {
    status,
    failedActivity,
    failureMessage,
    completedActivities: [...completedActivities],
    compensatedActivities: [...compensatedActivities],
    fixHistory: [...fixHistory],
    compensationHistory: [...compensationHistory],
    application: { ...app },
    cancelReason,
    notificationMessage,
    agentRecommendation,
  };
}
