# Ask about a decision — a side Opus chat on a decision card

Prototype: proto-1795711444-k9n8p2 (inline variant, Mist dark). Task: task-1795711407-h87w9p.

## Context

To answer a decision (`dec-…`), the user often needs more context than the decision's body gives. They want to question a fresh Opus agent from the decision itself: an icon next to the note toggle, and a thread inline in the card. The agent must be read-only. It must not file tasks, message agents, edit files or push, and it carries none of the supervisor's instructions. Nothing in the chat reaches the agent that asked the decision.

Decided with the user:
- A fresh agent, not a fork of the supervisor's session (forking is risky, the context is long, and the instructions would be wrong).
- No pre-extracted brief: the agent reads the transcripts itself.
- It gets the task/conversation tree, and is told where the task outcome reports are.
- Bash runs in Claude Code's sandbox, with no extra guard and no commit/push test.

## Design

Almost everything exists already. "Ask equin" (`plugins/hints/plugins/ask`) is the precedent: a scratch profile with `sandbox: true`, `useStartThread`, and `<AgentThread>`.

### New plugin `plugins/tasks/plugins/decisions/plugins/ask`

**core/**
- `DECISION_ASK_PROFILE = "tasks.decisions.ask"` and `DecisionAskInputSchema = { decisionId }`.
- `decisionAskConfig` (`defineConfig`): `model` (default Opus) and an `instructions` prompt template (`promptField`). Both are editable in Settings → Config, like `askConfig`.
- The subject kind `decision-ask`, for `tasks/task-subject`.
- A task category, "Decision questions", registered the way Ask registers Help. It keeps these tasks out of every supervisor tree and groups them in the Agent Manager.

**machine/ — the scratch profile** (`defineScratchProfile`, modelled on `plugins/hints/plugins/ask/machine/internal/profile.ts`):
- `instructions(input)` (sync) writes CLAUDE.md:
  - The config template: "you help the user decide; read anything, change nothing; you are not the agent that asked, and nothing you say reaches it".
  - The main checkout path (`checkoutRootPath()`, same helper as Ask).
  - `@context.md`.
- `prepare({ dir, input })` (async) writes `context.md`:
  - **The decision in full**: `readDecisionInFull` + `decisionLines` (already used by `read_decision`), plus the user's current note.
  - **The tree**: `taskTree({ conversationId: decision.openedByConversationId })` from `tasks/orchestration/tree-digest/server`. It is the asking agent's mandate subtree (the supervisor's tree), with the decision's own task marked.
  - **Conversations**: the asking conversation's transcript paths (`resolveConversationTranscriptPaths`). For any other conversation in the tree, the agent calls the `transcript_paths` tool (below). Hints: use `rg` / `jq` over the JSONL, and read only the slices the question needs.
  - **Outcome reports**: the `tasks_ext_outcome_report` table, read with `query_db` by `task_id`. It holds the hand-back report of each worker in the tree.
  - Written at launch. The agent re-reads anything newer itself.
- `permissions`: allow Read / Grep / Glob / Bash; deny Write / Edit / NotebookEdit.
- `sandbox: true`.
- `mcpTools`: `read_decision`, `query_db`, `transcript_paths`, `get_timeline`, `read_page`.
  - Excluded: `add_task`, `message_agent`, `edit_page`, `write_agent_note`, `flag_raise` and `exit_clean`. It ends its turn so the user can reply.

**server/**
- Registers the profile, the config and the category.
- No routes: the launch goes through the existing task-launch endpoint.

### New read-only MCP tool `transcript_paths`

Lives in `plugins/conversations/plugins/transcript-api`, which already serves the same data over HTTP: `GET /api/conversations/:id/transcript`.
- Input: a `conv-…` id. Output: the ordered JSONL paths, from `resolveConversationTranscriptPaths`.
- Generic and harmless, so it is visible to every agent and listed in the new profile.
- The sandbox blocks the agent's network, so it can't reach the HTTP route itself.

### Small extension to `useStartThread`

`plugins/conversations/plugins/agent-thread/web/internal/use-start-thread.ts`:
- `StartThreadRequest` gains an optional `subject?: TaskSubject`, passed through to `useTaskLaunch().launch(…, { subject })`, which already supports it.
- This makes a decision's chat a task reused by subject: one thread per decision, found again after a reload or from another surface.

### Web (decisions/ask/web)

- **`DecisionCardSlots.AnswerAction`** → `DecisionAskToggle`. It sits beside the note toggle, on the field's right, as in the screenshot.
  - Icon `forum`, tooltip "Ask Opus about D24 — never sent".
  - A dot while the decision has a thread and the chat is closed.
- **`DecisionCardSlots.AboveAnswer`** → `DecisionAskThread`, shown while the chat is open.
  - Reads the thread with `useSubjectTask({ kind: "decision-ask", id })`, then takes the task's latest conversation.
  - It renders `<AgentThread conversationId height="hug" placeholder="Ask about D24…">`. User turns are boxed (AgentThread's bubbles), the composer is last, and the answer field stays below it.
  - The header is minimal: "Opus · never sent" and a close ✕. `OpenConversationButton` stays available in a tooltip/menu, not as chrome.
  - No conversation yet: a composer only. The first send calls `start({ title: "Ask about D24 — <question>", prompt, input: { decisionId }, subject })`, with `profile`, `categoryId`, `filedFrom: "tasks.decisions.ask"` and `model` from config.
- **Open/closed state**: shared by the toggle and the area through `primitives/side-note`'s pattern. This is a page-wide store keyed by `decision:<id>`. If that hook is note-specific, use a tiny `kept-state` entry instead. Check `useSideNote` first.
- **Availability**: `useStartThread().availability` disables the toggle (with its reason) on hosts without the computer.
- **Order in AboveAnswer**: the thread sits above the note area, so the field stays the last element (the user's rule). Use `defineRenderSlot` order, not numbers.

### Surfaces

All three render `DecisionCard`, so they get the chat with no extra work: the inbox detail pane, the conversation tray and the page block.

## Critical files

- New: `plugins/tasks/plugins/decisions/plugins/ask/{core,machine,server,web}/index.ts` and their internals.
- Modify:
  - `plugins/conversations/plugins/agent-thread/web/internal/use-start-thread.ts` (subject).
  - `plugins/conversations/plugins/transcript-api/server/` (the `transcript_paths` tool).
- Reuse:
  - `defineScratchProfile` (`conversations/workspace/server`).
  - `AgentThread`, `useStartThread` (`conversations/agent-thread/web`).
  - `useSubjectTask` (`tasks/task-subject/web`).
  - `taskTree` (`tasks/orchestration/tree-digest/server`).
  - `readDecisionInFull` / `decisionLines`. These are internal to `decisions/server` today, so export them from the barrel as one `renderDecisionInFull(id)`.
  - `resolveConversationTranscriptPaths` (`conversations/transcript-watcher/server`).
  - `checkoutRootPath` pattern (`hints/ask/machine/internal/checkout.ts`). Check for a shared helper first; if it is Ask-private, use `getMainRepoRoot()` directly.

## Verification

1. `./equin build`; `./equin check`; `./equin test` on decisions, agent-thread and transcript-api.
2. Unit test: the profile's `prepare` writes `context.md`, and that file holds the decision, the tree (with the asking task marked) and the transcript paths. Use a fake decision and tree through the existing test fixtures.
3. Real run on this build:
   - Open a decision in the inbox and click the Ask icon.
   - Ask "What did the agent try before opening this?" The answer should quote the asking transcript.
   - Reload: the thread is still there and the toggle shows its dot.
   - The asking conversation received no turn.
4. Look: an e2e `decisions/ask/e2e/ask-thread.ts` screenshots the open chat in the inbox (Mist dark). Register a before/after with `register_before_after`.
