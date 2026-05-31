# Module 3 · The recoverable pattern (45 min)

**Goal:** when an activity fails on bad data, pause the workflow, let a human fix
the data with a signal, and retry — instead of failing the whole loan.

This module's `starter/` contains the Module 2 solution.

## Run it

This time start the **bad-ssn** scenario — its credit check will fail:

```bash
# Terminal 2 — worker
npx ts-node workshop/module-3-recoverable/starter/src/worker.ts

# Terminal 3 — start a loan whose SSN is invalid
npx ts-node workshop/module-3-recoverable/starter/src/client.ts bad-ssn
```

The activities already throw `ApplicationFailure.nonRetryable(...)` on bad input
(see [starter/src/activities.ts](./starter/src/activities.ts)). With the starter
code, `LOAN-002` will just **fail** at the credit check. Your job is to make it
*pause and wait for a fix* instead.

## Your task

Edit [starter/src/workflows.ts](./starter/src/workflows.ts) and complete the
`// TODO(module-3)` blocks:

1. Write a `recoverableStep(name, fn)` helper:
   - `try` to run the activity and return its result.
   - On failure: set status `PENDING_FIX`, record the failed activity + message,
     reset `retryRequested = false`, then `await condition(() => retryRequested)`.
   - When the retry signal arrives, loop and try again.
2. Add a `retry` signal whose handler patches one field on the application and
   sets `retryRequested = true`.
3. Wrap each forward activity call in `recoverableStep(...)`.

## Try it

`LOAN-002` will be stuck at `PENDING_FIX` on `runCreditCheck`. Fix the SSN:

```bash
temporal workflow signal --workflow-id LOAN-002 --name retry \
  --input '{"key":"ssn","value":"222-33-4444"}'
```

Watch it resume and finish the pipeline in the UI.

## Concepts

- **`ApplicationFailure.nonRetryable(...)`** — tells Temporal *"don't auto-retry,
  this needs human input."* (Contrast with normal errors, which Temporal retries
  automatically per the activity's retry policy.)
- **Pause-and-resume** — `condition` + a signal is the canonical way to block on
  out-of-band human action and continue deterministically afterward.

## Stuck?

See [solution/src/workflows.ts](./solution/src/workflows.ts).

Next: [Module 4 · A durable AI agent](../module-4-ai-agent/README.md)
