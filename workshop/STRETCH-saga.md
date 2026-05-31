# Stretch: the saga / compensation pattern

> Do this only if you finished Modules 1–4 with time to spare. It introduces one
> new idea: **undoing** work that already happened.
>
> Work on top of the Module 4 solution — e.g. copy
> `module-4-ai-agent/solution/src` into a new `stretch-saga/` folder and edit there.

## The problem

Some steps have **side effects in the outside world**:

- `runCreditCheck` files a *hard inquiry* on the applicant's credit.
- `underwrite` *reserves lending capacity*.

If the loan is cancelled or blocked **after** those steps ran, you can't just
stop — you've left real side effects behind. You need to *undo* them. That undo
is called a **compensation**, and running the compensations in reverse order is
the **saga pattern**.

## The exercise

Add one compensation: when a workflow is cancelled after the credit check, file
a credit-inquiry withdrawal.

1. **Add a compensation activity** in `activities.ts`:
   ```ts
   export async function withdrawCreditInquiry(applicationId: string, ssn: string): Promise<string> {
     await simulateProcessing();
     return `Credit inquiry withdrawal filed for ${applicationId} (SSN ...${ssn.slice(-4)})`;
   }
   ```

2. **Track compensations in the workflow.** Keep a stack and push an entry
   *before* you run a step that has a side effect (so it's registered even if the
   step fails partway):
   ```ts
   const compensations: Array<() => Promise<string>> = [];
   // before runCreditCheck:
   compensations.unshift(() => withdrawCreditInquiry(app.applicationId, app.ssn));
   ```

3. **Add a `cancelApplication` signal** that sets a `cancelRequested` flag.

4. **On cancel, unwind.** When `cancelRequested` becomes true, run every
   registered compensation in order (the stack is already reverse order because
   you used `unshift`), then end the workflow.
   ```ts
   for (const compensate of compensations) {
     await compensate();
   }
   ```

5. **Try it:**
   ```bash
   temporal workflow signal --workflow-id LOAN-001 --name cancelApplication \
     --input '{"reason":"Applicant withdrew"}'
   ```
   Watch the credit-inquiry withdrawal run, then the workflow finish.

## Things to think about

- **Idempotency.** Because you register a compensation *before* the step runs, it
  might fire even when the step didn't fully land. Real compensations must be
  safe to call when there's nothing (or only partial work) to undo.
- **Recoverable compensations.** A compensation can fail too (vendor outage).
  Wrap it in the same `recoverableStep` from Module 3 so it can pause-and-retry.
- **Cancellation during cancellation.** In production you'd run the unwind inside
  `CancellationScope.nonCancellable(...)` so an abort mid-unwind doesn't leave
  half-undone side effects.

The full, production-shaped version of all of this — LIFO stack, idempotent
compensations, recoverable compensations, and non-cancellable unwind — lives on
the repo's `main` branch in `src/workflows.ts`.
