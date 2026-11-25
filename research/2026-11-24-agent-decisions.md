# Agent decisions: a first-class "the user must decide" record

Status: design, not implemented (revised with the user's answers). Prototypes:
`proto-1795554689-lckhlw` (agent manager inbox + tray — the UX implemented
here) and `proto-1795551489-u4hyfv` (an earlier page-only take, input only).

## Context

Supervisors and workers stop on points only the user can settle. Today they
hand-write `### D22 — …` headings into an agent page ("Still open" / "Decided",
e.g. page `block-15d9b94f-…`, "Session 2026-11-19"), with context, options,
"my take", the user's follow-up questions, and notes appended after the
decision ("being implemented", "pushed") — and move items between sections by
hand. Nothing counts them, nothing tells the agent the user answered, and the
user must open each page to find what waits on them.

The outcome: an agent opens a **decision** with one MCP call and keeps it
current; the user sees every decision that needs them in one **Decisions**
inbox in the agent manager (and in a tray above each agent's composer), drafts
answers for several, presses **one Submit**, and each answer reaches its own
agent as one turn. A page shows a task's decisions by embedding one block.

### End-user experience

Agent:

```ts
open_decision({
  label: "D22",                       // optional: next D<n> of this task when omitted
  state: "decision",
  question: "Cache equin.ai's homepage HTML at Cloudflare's edge?",
  body: "Since Cloudflare went live every request goes …\n\n| Region | … |",
  options: [
    { key: "A", text: "Cache the HTML for a few seconds, purged on every deploy.", recommended: true },
    { key: "B", text: "Turn on Argo Smart Routing." },
    { key: "C", text: "Accept it." },
  ],
})
// → { ok: true, decision: "dec-1795…", label: "D22" }
```

User: sidebar **Decisions 5** → Needs you → picks A on D22, types a question on
D17, presses ⌘↵. D22 moves to Sent; D17 stays in Needs you, "waiting for an
answer". The agent receives one event turn naming both, closes D22
(`update_decision({ decision: "D22", state: "closed", outcome: "A: cache 10 s, purge on deploy" })`),
answers D17 (`update_decision({ decision: "D17", reply: "…" })`, shown in D17
marked new), and later adds `update_decision({ decision: "D22", update: "Pushed a1b2c3, live since 14:10" })`.

On its session page the supervisor keeps one line, `<task-decisions
task="task-…"/>`, which draws the same panel as the tray.

## Resolved with the user

- **Decisions are separate from the page system.** No decision is stored or
  placed on a page; one `<task-decisions>` block embeds a task's decisions
  (§7). Edits are kept in the decision's own version history.
- **A finished agent is not reopened** by an answer (§5).
- **Drafts are browser-only** (kept-state).
- **Only interactive and supervisor agents** may open decisions.
- **No bell:** the sidebar count is the only attention signal.
- **A worker's decision goes straight to the user**, not to its supervisor.
- **"Got it" closes an FYI silently** — nothing is delivered.
- **An agent may not finish cleanly** (an `exitCleanPrecondition`, like
  `tasks.open-sidequests`) while its decisions still need the user or hold an
  answer it has not acted on, so the finished-agent path stays rare.
- **A pick on a finished agent's decision files no task**: it closes as
  "not sent", nothing more.
- **The conversation tray shows the collapsed "N closed" row too**, as the
  page block does.

## 1. Source of truth: a `decisions` table

The agent manager needs counts, per-agent grouping, tab slices and a live
tray; delivery needs state written in the same transaction as the turn it
submits (`submitTurn`'s `onRecorded(tx)`). A table under `network/live` gives
both. Nothing else holds a copy: the page block (§7) reads the table, and every
edit is recorded as a version through `history/engine`'s
`defineHistorySource("decision")`, so a decision has the version dialog
(`history/dialog`'s `VersionHistoryDialog`) a page has. The thread is
append-only on top of that. A version holds what the decision says (label, state, state label,
question, body, options, outcome, closed time), recorded after every edit; the
engine coalesces versions within 10 minutes, so before a reopen the tool pins
the closed version ("Before reopening") and the old outcome survives.

## 2. Where it lives

`plugins/tasks/plugins/decisions/`. A decision belongs to a **task** (the
agent): it outlives the conversation that opened it (compaction, resume, a new
attempt), and its answer goes to the task's latest conversation, the way
`message_agent` addresses an agent (`agentOf`). Not `orchestration/`
(agent↔agent substrate), not `conversations/` (wrong owner).

```
plugins/tasks/plugins/decisions/
  core/    field records (Decision, Exchange, Option, DecisionState), decisionIdKind ("dec"),
           decisionExchangeIdKind ("dex"), liveCollection decls, the tab values,
           the answers endpoint
  server/  tables, the thread facts (a materializeJoin) + the tab SQL, serveCollection,
           history source, MCP tools, POST /api/decisions/answers, delivery, stop gate
  web/     DecisionCard, TaskDecisionsPanel, the drafts kept-state def, SubmitBar,
           the dec id-kind presenter
  plugins/
    capability/   the decisions.open capability (a core leaf, so mandate-presets grants it without a cycle)
    inbox/        Shell.Sidebar "Decisions" entry + panes (agent manager)
    tray/         Conversation.AbovePromptInput band (TaskDecisionsPanel)
    item-count/   Item.Chips count on sidebar conversation rows
    page-block/   the <task-decisions> block (TaskDecisionsPanel) + its read_page projection
```

## 3. The MCP tools

Defined with `Mcp.tool` (`plugins/infra/plugins/mcp/server`), registered from
`decisions/server`. The caller is `McpToolCallContext.conversationId` →
`getConversation` (`tasks-core/server`) → `taskId`. Visibility: `when:
granted(decisionsOpen)`, the `decisions.open` capability, granted by the
interactive preset and the supervisor preset's whole tree (root and workers)
only (`tasks/mandate-presets`). A decision
is addressed by id **or** by its label within the caller's task (`"D22"`).

```ts
const OptionInput = z.object({
  key: z.string().min(1).max(8),          // "A", "2", "A+B"
  text: z.string().min(1).max(240),       // ONE sentence (a newline is refused)
  recommended: z.boolean().optional(),    // at most one per decision
});

open_decision: {
  label?: string,                         // unique within the task; default next "D<n>" (one past the highest)
  state: z.enum(["decision", "action", "fyi", "other"]),
  stateLabel?: string,                    // required iff state === "other" ("Watching"); max 40
  question: z.string().min(1).max(300),
  body?: string,                          // arbitrary markdown, no fixed sections; max 20 000
  options?: z.array(OptionInput).max(8),  // keys unique
  from?: string,                          // lineage: the decision this one comes from (any task)
}
→ text: "Opened D22 (dec-…)."

update_decision: {
  decision: string,                       // id or label
  question?, body?, options?, state?, stateLabel?, label?,   // a patch: absent = unchanged
  outcome?: string,                       // required when state becomes "closed"; refused otherwise; max 500
  reply?: string,                         // answers the oldest unanswered user question
  update?: string,                        // a note in the thread ("Update · …"); max 4 000
}
→ text: "Updated D22 (dec-…, closed): closed, acted on the user's answer."
  (repo: { ok: true, id, label, state, transition: "closed" | "reopened" | null,
           consumed: { answers: number, question: boolean } } — one call may consume both)

list_decisions: { all?: boolean }         // the caller's task; open ones unless all
→ text: one line per decision — label, state, question, what the user last sent
```

Rules:

- **Only the owning task's conversations may update** a decision (the refusal
  names the owner). `from` may name any decision.
- **A closed decision stays a record.** `update` (a note: "being implemented:
  task-…", "pushed …", "live since …") and `reply` are allowed on it — this
  replaces appending notes under "Decided". Any other field is refused on a
  closed decision unless the same call sets a non-closed `state`, which
  **reopens** it (`closed_at` and `outcome` cleared, the old outcome kept in
  its history). So a closed decision's question, options and outcome cannot
  drift silently after the fact.
- **Split** needs no tool: open the parts with `from: "D17"`, close D17 with
  `outcome: "Split into D17a, D17b"`. "Split into" is derived (decisions
  whose `from` points at it), never stored. Moving a decision to a new
  supervisor session is the same: `open_decision({ from })`, close the old one.
- Refusals are discriminated (`{ ok: false, reason, message }`), never a silent
  no-op: `unknown-decision`, `not-yours`, `unknown-from`, `too-many-decisions`,
  `too-many-exchanges`, `label-invalid`, `label-taken`, `state-label`,
  `options-invalid` (duplicate key, a newline, a second `recommended`),
  `close-needs-outcome`, `outcome-without-close`, `closed-edit`,
  `no-pending-question`, `nothing-to-update`.
- **Labels**: 1–32 letters, digits, `.`, `_`, `-`, starting with a letter or
  digit, and never in the shape of a decision id (so a ref is never
  ambiguous). A label resolves within the caller's task only; an id resolves
  anywhere.
- An `other` decision keeps its `stateLabel` until its state moves off
  `other` (then it is cleared).
- The agent never writes a decision through the page tools.

## 4. Data model

`decisions/server/internal/tables.ts`.

**`decisions`**

| column | |
|---|---|
| `id` | `dec-…` (`decisionIdKind`) |
| `task_id` | FK `tasks` ON DELETE CASCADE — the owner. Growth bound: the cascade + `DECISIONS_PER_TASK_MAX` (200; `open_decision` refuses more) |
| `opened_by_conversation_id` | no FK (a statement that stays true, as `authorship` does) |
| `label` | unique per `task_id` |
| `state` | `decision \| action \| fyi \| other \| closed` |
| `state_label` | non-null iff `other` (CHECK) |
| `question`, `body` | text, markdown |
| `options` | `parsedJson(cappedList(Option, 8))` |
| `from_decision_id` | FK `decisions` ON DELETE SET NULL |
| `outcome` | non-null iff `closed` (CHECK) |
| `opened_at`, `closed_at`, `updated_at` | `updated_at` via `derived-updated-at` |
| `seen_at` | when the user last opened it; the "new" dot is `latest agent text > seen_at` (single owner principal; `POST /api/decisions/:id/seen`) |

**`decision_exchanges`** — the thread, append-only except the agent's reply.
It outlives closing: notes after the outcome are ordinary rows.

| column | |
|---|---|
| `id` | `dex-…` (`decisionExchangeIdKind`) |
| `decision_id` (FK cascade), `created_at` | (bounded per decision: 200, the tools refuse more) |
| `kind` | `answer` (a pick, + optional note) · `question` (a note, no pick) · `update` (agent note, open or closed) · `recorded` (an answer kept but not delivered, §5) |
| `pick` | option key (`answer`, `recorded`) |
| `user_text` | the note / question |
| `agent_text`, `agent_at` | the reply (`question`), the note (`update`) |
| `turn_id` | the event turn that delivered it (`turnIdKind`) |
| `consumed_at` | `answer`: when the agent next updated the decision — ends "Sent" |

**The tab is derived once**, read by every surface. Not a view: a live
collection is served from a table, never a view (network/live), so the
thread's facts are stored per decision — `decision_exchange_facts`, a
query-resource `materializeJoin` of the exchanges by `decision_id`
(pending questions, unconsumed answers, the agent's latest text) — and the
tab is one SQL definition (`decisionTabSql`, `server/internal/facts.ts`)
rendered by the live window (an `expr` field, filterable and sortable like a
column) and by `list_decisions`:

- `closed` → **Closed**
- an `answer` with `consumed_at IS NULL`, or `state = other` → **Sent**
- `fyi` → **FYI**
- otherwise → **Needs you** (a pending question keeps it here)

The closed line shows the outcome; expanding it shows the thread, the
post-closing `update` notes last.

**Drafts:** one kept-state work-tier entry, `defineKept({ owner: "decisions",
tier: "work", schema: cappedRecord(decisionId → { pick?, note }) })`, subject
`"answers"`. Survives navigation and reloads; the inbox, the tray and the page
block read the same entry. Submit goes through `submitKept`, which clears the
submitted keys only once the endpoint accepted them.

## 5. Delivery

`POST /api/decisions/answers` (`defineEndpoint`, owner access):

```ts
body:     { submissionId: string, answers: [{ decision: DecisionId, pick?: string, note?: string }] }
response: { delivered: [{ taskId, turnId, decisions: DecisionId[] }],
            recorded:  DecisionId[],                       // agent finished: kept, not sent
            refused:   [{ decision, reason: "closed" | "unknown-pick" | "resume-blocked" | … }] }
```

A batch with partial outcomes, so a discriminated result, not a throw. The web
keeps refused drafts and shows each reason on its row.

- **One turn per agent**, all its answers in it, grouped by `task_id`.
- **Path:** `submitTurn(latestConversation, { id, kind: "event", text,
  typedText: text, onRecorded: tx => insert the exchanges })` — exchanges and
  turn commit together; `id` (from `submissionId` + task) makes a retried
  Submit a no-op. `message`'s resume-then-submit (`send.ts`: `gone` →
  `resumeConversation`; hibernated → `submitTurn` resumes it;
  `ResumeBlockedError` → refusal) is **extracted** into an exported
  `deliverEventTurn(taskId, turn)` in `orchestration/message/server`, used by
  both.
- **A finished agent is not reopened.** When the task's latest conversation is
  `done`:
  - Before Submit, the decision's card shows "<agent> has finished — your
    answer will be kept here, not sent", and the SubmitBar's hint counts it
    apart ("2 to send, 1 to keep").
  - On Submit nothing is delivered. A pick is stored as a `recorded`
    exchange and **closes** the decision with outcome "You chose A (not sent:
    the agent had finished)", so it leaves Needs you and the choice stays on
    the record — a later agent reading the page (§7) sees it. A note without a
    pick is stored as a `recorded` exchange and the decision stays open; the
    card offers "Close" to settle it without a pick.
- **Typed now**, like a person's turn and like `message_agent`.
- **Content** (the ledger wraps it in `<equin-event>`; `event-turn` draws it as
  a folded system card):

  ```
  The user answered 2 of your decisions:

  <decision-answer decision="dec-…" label="D22" pick="A">Do it, but keep it under 10 s.</decision-answer>
  <decision-question decision="dec-…" label="D17">Why can't the restart be rolling?</decision-question>

  Act on each answer, then close it with update_decision({ decision, state: "closed", outcome }) —
  or update it if it needs the user again. Answer each question with update_decision({ decision, reply }).
  ```

- **The reply lands only through the tool.** `reply` fills the oldest
  unanswered `question`; any update to a decision with an unconsumed `answer`
  sets its `consumed_at`. The agent's turn text is never parsed.
- **Owing is enforced:** a `StopGate` (`conversations/stop-gate`) blocks the
  agent's stop while its task has a delivered question without a reply or an
  answer not consumed, naming the labels.
- **FYI "Got it"** closes it client-side through the same endpoint as a
  `recorded` "seen" with outcome "Seen", nothing delivered.

### As landed (phase 3)

Where the code differs from the above:

- **Delivery is the desktop's half** — `decisions/machine`: the endpoint is
  `needsMachine` (it types into agents through `conversations`, which a
  browser host does not boot), served by `implementMachine`; a client without
  the computer is told so on the SubmitBar.
- **A finished agent is read as its own value**, `decisions.agent-finished`
  (`{ taskId } → boolean`, machine): the task's latest conversation under its
  mandate is `done` — the reading `deliverEventTurn` takes (orchestration/
  message's `latestAgentConversation`, one SQL fragment shared with
  `agentOf`). The card and the SubmitBar read it per drafted task.
- **Drafts** are `{ pick, note, close, refused }` per decision in one record
  entry, each card's draft a kept part of it (kept-state's new `keptEntry`).
  Not `submitKept`: a batch clears only the drafts the server took (and only
  while unchanged), keeping each refused one with its reason.
- **`close`** is the one "settle it without telling the agent" answer: "Got
  it" on an FYI (outcome "Seen"; a note with it kept as `recorded`), and
  "Close without answering" on a finished agent's decision; refused
  (`close-not-allowed`) on a live agent's decision or action.
- **Idempotency**: the turn id is derived from `submissionId` + task + what it says, so a
  retried Submit is a duplicate turn the ledger ignores (its exchanges were
  written with the first). Response: `delivered[]` carries `conversationId`
  too; `refused[]` carries `message`; reasons are `ANSWER_REFUSALS`.
- **Gates**: the `decisions.owed` stop gate (a question waiting for a reply,
  an answer not acted on) and the `decisions.unsettled` exit_clean
  precondition (those, plus a `decision` / `action` still waiting on the
  user).
- **Inbox**: groups by `taskId` (labelled by the task's title through the
  field's live options), each tab chip counts its tab (data-view's new
  `DataViewSwitcher` `sourceCounts`), rows say their drafted answer, 1–9 pick
  on the open decision. j/k are not bound yet.

### As landed (phase 4)

- **`TaskDecisionsPanel({ taskId, inboxLink, whenSettled })`** in
  `decisions/web`: the open decisions and the closed ones are two DataView
  lists over `decisionsList` scoped to the task (`tab ne closed` / `tab =
  closed`), each row expanding inline through the list's `detail` +
  `detailOnActivate` into `DecisionCard`; the closed list sits behind a
  collapsed "N closed" row. `inboxLink` is the caller's (decisions/web names
  no pane); `whenSettled: "hide"` draws nothing while no decision is open (the
  tray), `"show"` always (the page block).
- **The tray** is `decisions/tray` (`Conversation.AbovePromptInput`, placed
  just above running-agents). The chip is `decisions/item-count`
  (`Item.Chips`), an exact `count` per row's task — not a grouping of
  `taskId`, whose group cap would read a task past it as zero.
- **j/k in the inbox** is the data-view list's new `stepKeys` option (steps
  the rows as drawn, runs the row's activation, reveals the row).
- **Tab counts** ("Needs you2"): the view-switcher chip draws its label as one
  inline run, where the chip's flex gap never applies; `ChipMarks` now parts
  the count and the dirty dot with a literal space.

### As landed (phase 5)

- **The editor additions**, generic (agent-access names no block type):
  `BlockTag.body: "derived"` (a read-only body, discarded on parse; its lines
  asserted inert at serialize — no blank line, fence opener or registered tag
  line — so a projection cannot close an enclosing card),
  `MarkdownNode.derivedBody`, `ReadBlockOptions.reader: { conversationId }`,
  `Editor.BlockProjection({ type, project(rows, reader) → id → { attrs, body } })`
  merged with the annotations by `resolveBlockReadFacts` (a double claim
  throws). agent-access passes the reader on `read_page` and on `edit_page`'s /
  `write_agent_note`'s own reads.
- **"Parse refuses a dangling task"** is split in two: parse checks the
  attribute is a task id (sync, pure); existence is
  `Editor.BlockReferenceCheck`, run by markdown-apply over the blocks an apply
  creates or re-points, before anything is written (400). Only the markdown
  path is checked; the slash-menu picker offers real tasks only.
- **The tag reads** `<task-decisions title="…" task="task-…">` — annotated
  attributes go before a type's own. The owner's stub is
  `<task-decisions title="…" own="4 open, 3 closed" task="…"/>`; a gone task
  `missing="task deleted"`. In full, each decision is a `<decision …>` line,
  its body quoted (`> `, line endings normalised), options `<option …/>`, its thread `<exchange …/>`.
- **Shortcuts are scoped to their region**: the Follow ups task
  task-1795567631-5jfjvf landed shortcut regions on main
  (`ShortcutDescriptor.region`, the SubmitBar's ⌘↵ focus-only, each
  TaskDecisionsPanel its own root), so two panels on a page never send each
  other's drafts. Phase 5 added one rule: when the focused element is a
  container around the last press (a page block's caret host, or the body),
  the pressed element is where focus is.

## 6. Live surfaces and the plugin split

Reads, all `network/live`:

- **`decisionsList`** — `liveCollection("decisions.list")` over the
  `decisions` table, its thread facts and its task (decision + `tab` +
  `taskTitle` + `pendingQuestions` + `unconsumedAnswers` + `latestAgentAt` +
  `isNew`), filterable on `tab` / `taskId` / `fromDecisionId` / `state`,
  `limit` 100 / `maxLimit` 500, `count: true`. The task's latest conversation
  and its status are **not** on the row: a window cannot join a rollup
  (`all`-only), so phase 3 reads them as their own value, `decisions.agent-finished` (§5, *As landed*).
  - Sidebar count: a `useLive` grouping of `tab` (one subscription, every tab's count).
  - Per-agent counts: a grouping of `taskId` where `tab = needs`.
- **`decisionExchanges`** — a scoped set by `decisionId` (`all: { by,
  max: 200 }`), oldest first (the card shows the latest, earlier folded).

| plugin | contributes | slot |
|---|---|---|
| `decisions/inbox` | "Decisions" entry, `trail` = needs-you count | `Shell.Sidebar` (template: `tasks/automations/web/index.ts`, `app: agentManagerApp`) |
| `decisions/inbox` | `decisions` pane and `decision/:decisionId` detail beside it | `Pane.define` + `Pane.Register` |
| `decisions/inbox` | the list: `DataView` over `liveDataSource(decisionsList)` grouped by agent; the four tabs are `DataViewSwitcher` sources; SubmitBar at its foot; j/k, 1–4 | — |
| `decisions/tray` | `TaskDecisionsPanel` for the conversation's task, Submit scoped to it | `Conversation.AbovePromptInput` (`requires: []`; shape of `running-agents`) |
| `decisions/item-count` | "n" chip on a conversation row | `Item.Chips` |
| `decisions` (web) | `dec` presenter (inline `dec-…` opens the pane) | `IdKinds.Kind` / `IdKinds.Presenter` |
| `decisions/page-block` | `<task-decisions>` | `Editor.Block`, `Editor.BlockData`, `Editor.BlockProjection` (§7) |

Two shared components in `decisions/web`:

- **`DecisionCard`** — one decision in full: label, state pill, `from`, time,
  question, outcome or "Split into …", body, options with Recommended / Your
  pick, folded earlier exchanges, the latest, "Sent to <agent>", the note box.
- **`TaskDecisionsPanel({ taskId })`** — the tray widget: a "N decisions need
  you" header that folds on click, one row per open decision (state dot,
  label, question) expanding inline into its `DecisionCard`, a collapsed
  "N closed" row whose closed lines (label, outcome) expand to their thread
  (on the page block; the tray's is Q3),
  and a SubmitBar scoped to the task. The tray and the page block both draw it.

## 7. The `<task-decisions>` page block

One block that embeds **a task's decisions**; the page stores nothing else.

- **Data:** `{ taskId }`, the block's own attribute (`<task-decisions
  task="task-…"/>`), like page-link keeps its `pageId` in data. Not a
  block-keyed extension: todo/task-link needs one because its task is
  attached *after* the card exists and its data must stay `{}`; here the task
  is known at mint, is the block's whole meaning, and never changes — one fact,
  one place, no create hook to keep in step. A deleted task draws "task
  deleted" rather than cascading a block out of someone's page.
- **How it gets onto a page: the agent writes it with `edit_page`** in a
  region it may write (its agent page or an `<agent-inline>` card), typically
  once, near the top of its session page. Chosen over a tool parameter or an
  automatic insertion because placement is a page concern the page tools
  already govern (agent-access's write rule decides where), and the
  decisions plugin then names no page at all. Parse **refuses** a
  `<task-decisions>` whose `task` names no task (loud, through
  `BlockData` validation), so markdown may keep, move or delete one, never
  mint a dangling one. Any task may be named (a supervisor may embed a
  worker's decisions). A person inserts one from the slash menu with a task
  picker.
- **In the editor** it draws `TaskDecisionsPanel` — answering on the page
  uses the same drafts and Submit.
- **In `read_page`** the block projects by reader:
  - another agent sees it **in full**, read-only: per decision its label,
    state, question, body, options, thread and outcome, as `<decision …>`
    children of the tag — readers keep seeing every decision as on today's
    pages;
  - **the owner** (the reading conversation's task is the block's task) sees
    one stub: `<task-decisions task="task-…" own="4 open, 3 closed"/>` — it
    already has its tool results, the answer turns and `list_decisions`.
- **Where the projection lives: the block's own server projection, given the
  reader** — not agent-access, which must keep naming no block type. Today
  `read_page` knows its caller only at the tool layer (`pageTools.read({
  block_id }, { conversationId })` in
  `agent-access/server/internal/page-tools.ts`); the engine
  (`markdown-apply`'s `readBlockAsMarkdown`) and `Editor.BlockAnnotation`
  (`resolve(rows)`, attributes only) know neither the reader nor a body. Two
  editor additions:
  - `ReadBlockOptions.reader?: { conversationId }`, passed by agent-access on
    every read it serializes — `read_page`, and `edit_page`'s and
    `write_agent_note`'s baseline reads, so an untouched block round-trips
    byte-identically for the same reader;
  - `Editor.BlockProjection` (server): `project(rows, reader) → blockId →
    { attrs, body }`, with a `BlockTag` flag `derivedBody` so parse
    **discards** the body (read-only, as `annotated` attributes are today).
    The decisions plugin supplies the projection; the owner test is
    `getConversation(reader.conversationId).taskId === data.taskId`.

## 8. Migration

None automatic. Existing hand-written D-items stay as prose. The supervisor
prompt (`supervisor-roles`' shared prompt config) changes from "write D-items
on your page" to "open decisions with `open_decision` and embed
`<task-decisions task=…/>` once on your session page". A live session may
re-open its still-open items through the tool when the user asks, then delete
its prose copies.

## 9. Phases (each pushable)

1. **Record + tools.** `decisions` plugin: tables, the thread facts rollup, `dec` / `dex` id
   kind, capability + presets, the three tools (closed-decision rules
   included), history source, `decisionsList` / `decisionExchanges`.
2. **Inbox, read-only.** Sidebar entry + count, panes, DataView + switcher,
   `DecisionCard`, seen marker.
3. **Answering.** Kept drafts, SubmitBar, the answers endpoint,
   `deliverEventTurn` extracted from `message`, the finished-agent path, the
   stop gate, Sent state.
4. **In the conversation.** `TaskDecisionsPanel`, the tray, `Item.Chips`.
5. **On the page.** The `<task-decisions>` block (editor + slash menu + parse
   validation), the editor's `reader` option and `Editor.BlockProjection`
   with `derivedBody`, the full projection and the owner stub.
6. **Adoption.** Supervisor prompt.

## 10. Tests

- `server/internal/*.test.ts` (db-test-fixture): tab derivation from the
  stored thread facts (each state × exchange kind), label uniqueness and
  auto-numbering, the caps, the CHECKs.
- Tool handlers as pure functions over ports (the `message` pattern):
  ownership, `reply` without a pending question, close without outcome,
  `update` on a closed decision accepted, other edits refused, reopen.
- Delivery: grouping per task, idempotent `submissionId`, partial refusal, the
  finished-agent `recorded` path, `onRecorded` rollback, the turn text.
- Projection: the same page read by the owner (stub) and by another agent
  (full), and that both round-trip through `edit_page` unchanged.
- `web/__tests__/`: one draft entry shared by two panels, `submitKept` keeping
  refused drafts, SubmitBar scope counts.
- e2e `decisions/inbox/e2e/answer-batch.ts`: two decisions on two tasks,
  draft both, Submit, both move tabs, two event turns recorded.
