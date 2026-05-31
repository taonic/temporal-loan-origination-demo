# Workshop: Durable AI Agents with Temporal

A 3-hour, hands-on workshop. You will build a loan-origination workflow from
scratch, one concept at a time, and finish with a **durable AI underwriting
agent** running as a child workflow.

No prior Temporal or agentic-AI experience required.

---

## What you'll build

```
Verify Income → Credit Check → Underwriting → AI Agent Review → Human Approval
```

Across four modules:

| Module | You add | New Temporal concept |
|--------|---------|----------------------|
| 1 · Durable pipeline | 3 activities + a linear workflow | activities, retries, **durability** |
| 2 · Signals & Queries | human approve / reject step | signals, queries, `condition` |
| 3 · Recoverable pattern | pause-fix-retry on a failed step | `ApplicationFailure`, signal-driven recovery |
| 4 · Durable AI agent | LLM underwriter as a child workflow | child workflows, agentic tool-loop |

There is also an **optional stretch** (saga / compensation) — see
[STRETCH-saga.md](./STRETCH-saga.md). The full reference implementation of every
pattern lives on the repo's `main` branch.

---

## Checkpoints (git tags)

You edit the files in `workshop/src/`. Every module has a solution tag so you
can never get stuck:

```bash
git checkout start       # the starting point (module-1 stubs)
git checkout module-1    # module 1 complete
git checkout module-2    # module 2 complete
git checkout module-3    # module 3 complete
git checkout module-4    # everything complete
```

Peek at a single solution file without changing your working copy:

```bash
git show module-2:workshop/src/workflows.ts
```

When you start, run `git checkout start`.

---

## Prerequisites (do this BEFORE the workshop)

1. **Node.js 18+** — `node --version`
2. **Temporal CLI** — https://docs.temporal.io/cli#install
   ```bash
   temporal --version
   ```
3. **Ollama** (the local LLM for module 4)
   ```bash
   # from the repo root — pulls the ~1GB qwen2.5:1.5b model
   npm run llm
   # watch the pull finish:
   docker compose logs -f ollama-pull
   ```
4. **Install deps** (from the repo root):
   ```bash
   npm install
   ```
5. **Smoke-test** that the Temporal dev server starts:
   ```bash
   temporal server start-dev
   # open http://localhost:8233  — this is the Temporal Web UI
   # Ctrl-C to stop for now
   ```

---

## Running things

You will use **four terminals**. All commands run from the repo root.

```bash
# Terminal 1 — Temporal dev server (Web UI on http://localhost:8233)
temporal server start-dev

# Terminal 2 — the worker (re-run after every code change)
npx ts-node workshop/src/worker.ts

# Terminal 3 — start a loan application
npx ts-node workshop/src/client.ts

# Terminal 4 — for sending signals / queries (module 2+)
#   e.g. temporal workflow query --workflow-id LOAN-001 --type getState
```

> The worker does **not** hot-reload. After editing a workflow or activity,
> stop it with Ctrl-C and start it again.

Open **http://localhost:8233** and click into your workflow to watch every step
appear in the event history. This native Temporal UI is the main thing you'll
be looking at all workshop.

---

## Module 1 · A durable pipeline (40 min)

**Goal:** run three activities in sequence and witness durable execution.

Open [src/workflows.ts](./src/workflows.ts) and [src/activities.ts](./src/activities.ts).

1. The three activities (`verifyIncome`, `runCreditCheck`, `underwrite`) are
   already written for you in `activities.ts`. Read them — each just simulates
   some processing and returns a string.
2. In `workflows.ts`, complete the `// TODO(module-1)` blocks: proxy the
   activities, then call them in order, updating `state.status` after each.
3. Start the worker (Terminal 2) and a workflow (Terminal 3).
4. Open the workflow in the Temporal UI and watch the three activities run.

**The durability demo — do this, it's the whole point:**

- Start a fresh workflow.
- While it's mid-pipeline, **kill the worker** (Ctrl-C in Terminal 2).
- Notice in the UI the workflow is *not* failed — it's just waiting.
- **Restart the worker.** The workflow picks up exactly where it left off, with
  no lost progress and no duplicated work.

That is *durable execution*: your business logic survives process crashes,
deploys, and machine restarts, for free.

Stuck? `git checkout module-1`.

---

## Module 2 · Signals & Queries — human in the loop (40 min)

**Goal:** pause the workflow for a human decision, inspect it while it waits,
and resume it from the outside.

In `workflows.ts`, complete the `// TODO(module-2)` blocks:

1. Define a **query** `getState` that returns the current `LoanState`.
2. Define two **signals**: `approveApplication` and `rejectApplication`
   (the reject signal carries a reason).
3. After underwriting, set status to `PENDING_APPROVAL` and **block** on
   `condition(() => approved || rejected)`.
4. On approve → status `APPROVED`. On reject → status `REJECTED`.

Try it from the CLI (Terminal 4) while a workflow is paused:

```bash
# read the live state without affecting the workflow
temporal workflow query --workflow-id <id> --type getState

# approve it
temporal workflow signal --workflow-id <id> --name approveApplication

# or reject it with a reason
temporal workflow signal --workflow-id <id> --name rejectApplication \
  --input '{"reason":"Policy exception"}'
```

A **query** is a read-only peek at workflow state. A **signal** is an
asynchronous message that drives the workflow forward. Together they let the
outside world observe and steer a long-running process.

Stuck? `git checkout module-2`.

---

## Module 3 · The recoverable pattern (45 min)

**Goal:** when an activity fails on bad data, pause the workflow, let a human
fix the data with a signal, and retry — instead of failing the whole loan.

The activities already throw `ApplicationFailure.nonRetryable(...)` on bad input
(e.g. an invalid SSN). The client starts one application with a **bad SSN** so
the credit check fails.

In `workflows.ts`, complete the `// TODO(module-3)` blocks:

1. Write a `recoverableStep(name, fn)` helper:
   - `try` to run the activity.
   - On failure: set status `PENDING_FIX`, record the failed activity + message,
     then `await condition(() => retryRequested)`.
   - When the retry signal arrives, loop and try again.
2. Add a `retry` signal that patches a field on the application and sets
   `retryRequested = true`.
3. Wrap each forward activity in `recoverableStep`.

Try it:

```bash
# a workflow will be stuck at PENDING_FIX on runCreditCheck — fix the SSN:
temporal workflow signal --workflow-id <id> --name retry \
  --input '{"key":"ssn","value":"222-33-4444"}'
```

Watch it resume and continue the pipeline.

`ApplicationFailure.nonRetryable` tells Temporal *"don't auto-retry, this needs
a human."* The `condition` + signal pattern is how you pause for that human and
resume deterministically.

Stuck? `git checkout module-3`.

---

## Module 4 · A durable AI agent (35 min)

**Goal:** run an LLM underwriter as a **child workflow** whose every model call
and tool call is a durable, replayable activity you can inspect in the UI.

Files for this module: [src/agent-activities.ts](./src/agent-activities.ts) (the
LLM call + two mock tools — already written) and
[src/agent-workflow.ts](./src/agent-workflow.ts) (the agent loop — has TODOs).

In `agent-workflow.ts`, complete the `// TODO(module-4)` blocks — the tool-call
loop:

1. Call the LLM activity (`callAgentLLM`) with the running message list.
2. If the model returned **tool calls**, dispatch each as its own activity and
   feed the results back into the conversation.
3. If the model returned **plain text** (no tool calls), it's done — parse the
   `DECISION / CONFIDENCE / RATIONALE` block and return the recommendation.
4. Cap the loop at `MAX_TURNS` and escalate if it's exceeded.

In `workflows.ts`, complete the `// TODO(module-4)` block: after underwriting,
run the agent with `executeChild(underwritingAgentWorkflow, ...)` and store the
recommendation on `state` before the human-approval step.

Run it (make sure Ollama is up — `npm run llm` in another terminal). In the
Temporal UI you'll see a **second workflow** (`<id>-agent`) with one activity per
model turn and one per tool call — the agent's reasoning, made durable.

> Why a child workflow? Each model call is non-deterministic, so it *must* live
> in an activity. Wrapping the loop in its own workflow gives the agent its own
> clean history, lets it run on a dedicated worker, and makes it independently
> inspectable and replayable.

Stuck? `git checkout module-4`.

---

## Wrap-up

You built a durable, recoverable, human-in-the-loop loan pipeline with an AI
agent — and none of it breaks when a process dies.

Where to go next:
- **Stretch:** [STRETCH-saga.md](./STRETCH-saga.md) — undo side effects with the
  saga / compensation pattern.
- **Reference:** the `main` branch has the full version (saga, cancellation
  propagation, search attributes, and a custom dashboard).
- **Docs:** https://docs.temporal.io
