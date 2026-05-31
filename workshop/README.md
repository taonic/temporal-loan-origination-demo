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

Each module lives in its own self-contained folder with a `starter/` (what you
edit) and a `solution/` (the answer), plus its own README:

| Module | Folder | New Temporal concept |
|--------|--------|----------------------|
| 1 · Durable pipeline | [module-1-durable-pipeline](./module-1-durable-pipeline/) | activities, retries, **durability** |
| 2 · Signals & Queries | [module-2-signals-queries](./module-2-signals-queries/) | signals, queries, `condition` |
| 3 · Recoverable pattern | [module-3-recoverable](./module-3-recoverable/) | `ApplicationFailure`, signal-driven recovery |
| 4 · Durable AI agent | [module-4-ai-agent](./module-4-ai-agent/) | child workflows, agentic tool-loop |

Each module's `starter/` already contains the **previous** module's completed
solution, so you can do the modules independently or in order. There is also an
optional [saga / compensation stretch](./STRETCH-saga.md). The full reference
implementation of every pattern lives on the repo's `main` branch.

```
workshop/
├── module-1-durable-pipeline/
│   ├── README.md
│   ├── starter/src/      <- you edit this (has TODOs)
│   └── solution/src/     <- the answer
├── module-2-signals-queries/   (same shape)
├── module-3-recoverable/       (same shape)
└── module-4-ai-agent/          (same shape)
```

---

## Prerequisites (do this BEFORE the workshop)

1. **Node.js 18+** — `node --version`
2. **Temporal CLI** — https://docs.temporal.io/cli#install — `temporal --version`
3. **Ollama** (the local LLM for Module 4), from the repo root:
   ```bash
   npm run llm                       # pulls the ~1GB qwen2.5:1.5b model
   docker compose logs -f ollama-pull   # watch the pull finish
   ```
4. **Install deps** (from the repo root): `npm install`
5. **Smoke-test the dev server:**
   ```bash
   temporal server start-dev
   # open http://localhost:8233 (the Temporal Web UI), then Ctrl-C
   ```

---

## How to run any module

You'll use **four terminals**, all from the repo root. Swap the module folder and
`starter`/`solution` as needed.

```bash
# Terminal 1 — Temporal dev server (Web UI on http://localhost:8233)
temporal server start-dev

# Terminal 2 — the worker (re-run after every code change)
npx ts-node workshop/<module-folder>/starter/src/worker.ts

# Terminal 3 — start a loan application
npx ts-node workshop/<module-folder>/starter/src/client.ts
#   add `bad-ssn` to start a failing application (used in Module 3)

# Terminal 4 — send signals / run queries (Module 2 onward)
#   e.g. temporal workflow query --workflow-id LOAN-001 --type getState
```

> The worker does **not** hot-reload. After editing a workflow or activity, stop
> it (Ctrl-C) and start it again.

Open **http://localhost:8233** and click into your workflow to watch each step
appear in the event history. This native Temporal UI is the main thing you'll be
looking at all workshop.

---

## Start here

→ **[Module 1 · A durable pipeline](./module-1-durable-pipeline/README.md)**

Then work through Modules 2, 3, and 4 in order. Each module's README has its own
run commands, tasks, and concept notes.

## Wrap-up

You'll have built a durable, recoverable, human-in-the-loop loan pipeline with an
AI agent — and none of it breaks when a process dies.

Where to go next:
- **Stretch:** [STRETCH-saga.md](./STRETCH-saga.md) — undo side effects with the
  saga / compensation pattern.
- **Reference:** the `main` branch has the full version (saga, cancellation
  propagation, search attributes, and a custom dashboard).
- **Docs:** https://docs.temporal.io
