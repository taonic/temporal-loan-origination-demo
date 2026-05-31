# Module 1 · A durable pipeline (40 min)

**Goal:** run three activities in sequence and witness durable execution.

Make sure the Temporal dev server is running (see the [top-level README](../README.md)).

## Run it

```bash
# Terminal 2 — the worker (re-run after every code change: Ctrl-C then up-arrow)
npx ts-node workshop/module-1-durable-pipeline/starter/src/worker.ts

# Terminal 3 — start a loan application
npx ts-node workshop/module-1-durable-pipeline/starter/src/client.ts
```

Open **http://localhost:8233**, click into `LOAN-001`, and watch the activities run.

## Your task

Edit [starter/src/workflows.ts](./starter/src/workflows.ts) and complete the
`// TODO(module-1)` block:

1. The three activities (`verifyIncome`, `runCreditCheck`, `underwrite`) are
   already written in [starter/src/activities.ts](./starter/src/activities.ts).
   Read them — each just simulates work and returns a string.
2. In `workflows.ts`, `await` each activity in order, and after each push its
   name onto `state.completedActivities` and update `state.status`
   (`INCOME_VERIFIED`, `CREDIT_CHECKED`, `UNDERWRITTEN`).

## The durability demo — do this, it's the whole point

- Start a fresh workflow.
- While it's mid-pipeline, **kill the worker** (Ctrl-C in Terminal 2).
- Notice in the UI the workflow is *not* failed — it's just waiting.
- **Restart the worker.** The workflow picks up exactly where it left off, with
  no lost progress and no duplicated work.

That is *durable execution*: your business logic survives process crashes,
deploys, and machine restarts, for free. Each `await` is a checkpoint recorded
in history; a restarted worker replays that history to rebuild state.

## Concepts

- **Workflow** — your durable orchestration code. Must be deterministic.
- **Activity** — a single unit of work that can have side effects (I/O, clocks,
  randomness). Its result is recorded so the workflow can replay deterministically.
- **`proxyActivities`** — turns activity functions into callable stubs that run
  on a worker via the task queue.

## Stuck?

The complete answer is in [solution/src/workflows.ts](./solution/src/workflows.ts).
Run it the same way, swapping `starter` → `solution` in the paths.

Next: [Module 2 · Signals & Queries](../module-2-signals-queries/README.md)
