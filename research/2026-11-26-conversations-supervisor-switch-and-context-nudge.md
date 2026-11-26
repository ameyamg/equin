# Self-switch to supervisor + context-size compaction nudge

## Context

Two harness gaps for long agent sessions:

1. An agent launched on a standard (interactive) task that discovers the work
   is big has no way to become a supervisor (split the work into child tasks,
   watch them). Today only the user can flip the task detail's Mandate select,
   or pick Supervisor at launch.
2. Agents only compact when Claude's auto-compaction fires — usually mid-step,
   at the worst moment. The `compact_context` tool (conversations/self-compact)
   exists but only supervisors have it, and nothing tells an agent *when* its
   context is getting large. We want a nudge at 500k tokens, then every +100k:
   "Your context is XX / YY — once you finish your current step, call
   `compact_context`", so compaction lands between steps (after implementing
   and before testing, between two parts of the implementation, …).

Both mostly reuse what exists: mandates are re-resolved on every MCP call, and
`mandate/change-notice` already reconnects MCP and re-sends the Mandate /
Supervisor / Task tree sections when a task's mandate changes; self-compact
already does the deferred `/compact` + continuation.

## Part 1 — `become_supervisor` MCP tool

**Where:** `plugins/tasks/plugins/supervisor-run/server/` (already depends on
`setMandate` from tasks-core and `supervisorMandate` from mandate-presets).

**Capability, not a hard-coded check.** New leaf capability
`mandate.escalate` (plain-data leaf `supervisor-run/plugins/capability/core`,
same shape as `self-compact/plugins/capability`), described through
`Mandate.Capability({ cap, describe })` so its line joins the Mandate section
("You may switch your own task to supervisor mode with `become_supervisor`
when its scope turns out too big for one context."). Granted by
`interactivePolicy()` (`tasks/plugins/mandate-presets/shared/policies.ts`)
only — a supervisor never sees it.

**Tool:** `Mcp.tool({ name: "become_supervisor", when: granted(mandateEscalate),
inputSchema: { reason: z.string() } })`. Handler (mirrors
`handlePutTaskMandate` in `tasks/plugins/task-mandate/server/internal/routes.ts`):

- caller = `getConversation(conversationId)`; refuse a side chat (its own
  stated `mandateRef`) — only the conversation running its task may switch it;
- refuse when the task states an owned mandate (`assertOwnMandateNotOwned`);
- `setMandate(taskId, supervisorMandate)` on the caller's own task (a root →
  root supervisor; a nested interactive task → supervisor sub-root, which is
  what the mandate model already means);
- record the reason as a notification to the user (`recordNotification`, "Task X
  switched itself to supervisor: <reason>") so the switch is never silent;
- return text: "Switched. Your tools and the Supervisor section arrive as the
  next turn; end this step, then plan the child tasks."

Nothing else to build: `tasks.mandateChanged` → change-notice reconnects MCP
(the supervisor tools appear: `add_task now`, `watch`, `message_agent`,
`compact_context`, …) and sends the re-rendered sections as an event turn.
Reverting stays the user's (task detail Mandate select).

## Part 2 — context-size nudge (in-process SDK hook)

**Where:** `plugins/conversations/plugins/runtime-sdk/bin/agent.ts`, as an
in-process `hooks.PostToolUse` callback passed to `claudeQuery` options (the
Agent SDK supports callback hooks — `sdk.d.ts` `hooks?: Partial<Record<HookEvent,
HookCallbackMatcher[]>>`, `PostToolUseHookSpecificOutput.additionalContext`).

Why here and not a settings.json command hook + server endpoint:
- **Fresh:** the agent already sees every SDK message. The main thread's last
  assistant message `usage` (`input_tokens + cache_creation_input_tokens +
  cache_read_input_tokens`, `parent_tool_use_id === null`) is the context size
  as of the latest API call. The stored `conversations.context-usage` reading
  only moves at turn end — useless inside a long autonomous turn.
- **Free:** no process spawn per tool call, no HTTP round-trip.
- **Window (YY):** `rawMaxTokens` from the `getContextUsage` measure the agent
  already does at ready and after every result (`measureContext`); keep the last
  one in a variable.

**Logic** — a pure module `runtime-sdk/core/context-nudge.ts` (unit-tested):

```ts
CONTEXT_NUDGE = { firstAt: 500_000, every: 100_000 }
bucketOf(tokens) = tokens < firstAt ? -1 : floor((tokens - firstAt) / every)
nextNudge(state, tokens, window) → { state, text | null }
```

- text when `bucketOf(tokens) > state.lastBucket`; then `lastBucket = bucket`.
- a drop (compaction) lowers `lastBucket` to the new bucket without a nudge, so
  the sequence restarts after a compaction.
- in memory: a restarted agent re-nudges once if still above the threshold —
  intended.
- one nudge per crossing, even if a tool call jumps two buckets.

Text: `Your context is 612k / 1M tokens. When you finish the step you are on
(the current part of the larger task — not mid-edit), call compact_context with
what to keep and the next step, so compaction happens at a clean break.`

The nudge is attached to the next PostToolUse after a crossing (a turn with no
tool calls has no break to attach to, and ends anyway). Each emitted nudge is
also written to `agent.log`.

**Granting `compact_context` to interactive agents:** add
`contextCompact.grant(true)` to `interactivePolicy()`. Automation mandates are
checked during implementation; any mandate an equin agent runs under should
grant it, since the nudge names the tool (the agent process cannot read its
mandate, which can change mid-session, so the grant is made universal rather
than the text made conditional).

## Files

- `plugins/tasks/plugins/supervisor-run/plugins/capability/core/` (new leaf)
- `plugins/tasks/plugins/supervisor-run/server/index.ts`, `server/internal/tool.ts`, `server/internal/capability.ts`
- `plugins/tasks/plugins/mandate-presets/shared/policies.ts` (interactive: `mandate.escalate`, `context.compact`)
- `plugins/conversations/plugins/runtime-sdk/core/context-nudge.ts` (+ test), `core/index.ts`
- `plugins/conversations/plugins/runtime-sdk/bin/agent.ts` (`hooks.PostToolUse`, track main-thread usage + window)
- CLAUDE.md of supervisor-run, self-compact (now interactive too), runtime-sdk (the nudge)

## Verification

- `./equin test plugins/conversations/plugins/runtime-sdk/core/context-nudge.test.ts` — thresholds, step, multi-bucket jump, compaction reset.
- Mandate-preset tests (if any) updated for the new interactive grants.
- `./equin build`, then in the worktree build: launch an interactive task, call
  `become_supervisor` → task detail shows Supervisor, the conversation receives
  the section notice, `add_task now` / `compact_context` listed.
- Nudge end-to-end: temporarily lower `firstAt` via the test only — not in
  shipped code; instead verify on a real long session's `agent.log` lines and
  the transcript's `hook_additional_context` attachment.
