# Module 2 · Signals & Queries — human in the loop (40 min)

**Goal:** pause the workflow for a human decision, inspect it while it waits,
and resume it from the outside.

This module's `starter/` already contains the Module 1 solution, so you can
build straight on top of it.

## Run it

```bash
# Terminal 2 — worker
npx ts-node workshop/module-2-signals-queries/starter/src/worker.ts

# Terminal 3 — start a loan
npx ts-node workshop/module-2-signals-queries/starter/src/client.ts
```

## Your task

Edit [starter/src/workflows.ts](./starter/src/workflows.ts) and complete the
`// TODO(module-2)` blocks:

1. Define a **query** `getState` that returns the current `LoanState`, and attach
   a handler with `setHandler`.
2. Define two **signals**: `approveApplication` and `rejectApplication` (the
   reject signal carries a `reason`). Their handlers flip local flags.
3. After underwriting, set status to `PENDING_APPROVAL` and **block** on
   `condition(() => approved || rejected)`.
4. On approve → status `APPROVED`. On reject → status `REJECTED` (store the reason).

## Try it from the CLI

While a workflow is paused at `PENDING_APPROVAL` (Terminal 4):

```bash
# read the live state without affecting the workflow
temporal workflow query --workflow-id LOAN-001 --type getState

# approve it
temporal workflow signal --workflow-id LOAN-001 --name approveApplication

# ...or reject it with a reason
temporal workflow signal --workflow-id LOAN-001 --name rejectApplication \
  --input '{"reason":"Policy exception"}'
```

## Concepts

- **Query** — a read-only peek at workflow state. Never mutates anything.
- **Signal** — an asynchronous message *into* a running workflow that drives it
  forward.
- **`condition(predicate)`** — durably suspends the workflow until the predicate
  becomes true (could be seconds or months). This is how you wait for a human.

## Stuck?

See [solution/src/workflows.ts](./solution/src/workflows.ts).

Next: [Module 3 · The recoverable pattern](../module-3-recoverable/README.md)
