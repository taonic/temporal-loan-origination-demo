# Module 4 · A durable AI agent (35 min)

**Goal:** run an LLM underwriter as a **child workflow** whose every model call
and tool call is a durable, replayable activity you can inspect in the UI.

This module's `starter/` contains the Module 3 solution.

> Make sure Ollama is up first (from the repo root): `npm run llm`. If the model
> is unreachable the workflow records an `ESCALATE` recommendation instead of
> crashing, so the pipeline still completes.

## Run it

```bash
# Terminal 2 — worker
npx ts-node workshop/module-4-ai-agent/starter/src/worker.ts

# Terminal 3 — start a clean loan
npx ts-node workshop/module-4-ai-agent/starter/src/client.ts
```

## Your task

Two files matter here:

- [starter/src/agent-activities.ts](./starter/src/agent-activities.ts) — the LLM
  call + two mock tools. **Already written.**
- [starter/src/agent-workflow.ts](./starter/src/agent-workflow.ts) — the agent
  loop. **Has the TODO.**

**Step 1 — the tool-call loop** in `agent-workflow.ts`, `// TODO(module-4)`:

For up to `MAX_TURNS`:
1. Call the LLM activity `callAgentLLM({ messages })`.
2. Record the assistant's turn (its text + any tool calls) onto `messages`.
3. If the model returned **no tool calls**, it's done — `parseRecommendation`
   the reply and return the structured recommendation (escalate if unparseable).
4. Otherwise **dispatch each requested tool** as its own activity, push the
   results back as a `tool` message, record them in `toolCallTrace`, and loop.

After the loop, return an `ESCALATE` recommendation (hit the turn cap).

**Step 2 — call the child** in `workflows.ts`, `// TODO(module-4)`:

After underwriting, run the agent and store its recommendation:
```ts
state.agentRecommendation = await executeChild(underwritingAgentWorkflow, {
  workflowId: `${app.applicationId}-agent`,
  args: [{ application: { ...app }, creditScore: 750 }],
});
```
(Wrap it in try/catch so an Ollama outage becomes an `ESCALATE` instead of a crash.)

## What to look for

In the Temporal UI you'll now see a **second workflow**, `LOAN-001-agent`, with
one activity per model turn and one per tool call — the agent's reasoning, made
durable and replayable.

## Concepts

- **Why an activity for the LLM call?** Model calls are non-deterministic.
  Workflows must be deterministic, so anything non-deterministic *must* live in
  an activity whose result is recorded.
- **Why a child workflow?** It gives the agent its own clean history, lets it run
  on a dedicated worker, and makes the whole tool-loop independently inspectable
  and replayable.
- **The workflow drives the loop** — not the AI SDK (`maxSteps: 1`). That's what
  makes each step a durable checkpoint instead of one opaque black-box call.

## Stuck?

See [solution/src/agent-workflow.ts](./solution/src/agent-workflow.ts) and
[solution/src/workflows.ts](./solution/src/workflows.ts).

Done? Try the optional [saga / compensation stretch](../STRETCH-saga.md).
