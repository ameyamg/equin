# decisions

A first-class "the user must decide" record: an agent opens a **decision**
with one MCP call and keeps it current; the user answers it from the agent
manager. Design: [`research/2026-11-24-agent-decisions.md`](../../../../research/2026-11-24-agent-decisions.md).

This plugin is the record, the tools and answering (`machine/` delivers the
user's answers into agents). The surfaces are sub-plugins: the Decisions inbox
(`plugins/inbox`), the conversation tray (`plugins/tray`), the per-row
count chip (`plugins/item-count`) and the `<task-decisions>` page block
(`plugins/page-block`, which reads the record through
`readTaskDecisionsInFull` / `existingTaskIds`, `server/internal/full-read.ts`,
and excerpts it). `read_decision` (any agent, ungated) returns one decision of
any task in full by its id — what a page's excerpt points to — in the same
`<decision>` lines (`decisionLines`, `server/internal/full-render.ts`).

## One task's decisions: `TaskDecisionsPanel`

`web/components/task-decisions-panel.tsx` — what the tray and the page block
draw: a header ("N decisions need you", folding the panel on click,
kept per task) with Open in Decisions (`inboxLink`, the caller's: this plugin
names no pane); the open decisions as a DataView list (`tasks.decisions.panel-open`,
Needs you → Sent → FYI, newest first) whose rows expand inline into
`DecisionCard` (the list's `detail` + `detailOnActivate`; shown ⇒ marked
seen); a collapsed "N closed" row over the closed ones
(`tasks.decisions.panel-closed`, each line its outcome); the SubmitBar
scoped to the task. `beside` (the tray's side pane: `isOpen` + its `toggle`) adds an icon
opening the decisions in a pane beside; while it is open the panel is its
header alone ("… · shown beside"), so the decisions are drawn once.
`TaskDecisions` is the same body unframed, what that pane draws.
`whenSettled: "hide"` (the tray) draws nothing while no
decision waits on the user (none in Needs you or FYI: a Sent one waits on the agent). Decisions are never drawn inline in the transcript: the
agent edits them after opening them, so they are shown live here.

The row fields every decision list shares — the state dot and the drafted
answer — are `web/internal/row-fields.tsx`.

## The record

- **`decisions`** — one row per question an agent asks, owned by its **task**
  (`task_id`, cascade): it outlives the conversation that opened it. Its
  `label` is unique per task (`D<n>` by default). `state` is `decision` /
  `action` / `fyi` / `other` (with `state_label`) / `closed` (with `outcome`
  and `closed_at`) — CHECKs hold those pairs. `updated_at` is derived (what
  the decision says; `seen_at` does not count).
- **`decision_exchanges`** — the thread: `answer` (a pick), `question` (a note
  without a pick, answered by the agent's `reply`), `update` (an agent note,
  also after closing), `recorded` (an answer kept, not delivered). Append-only
  but for the reply and an answer's `consumed_at`.
- **Caps**: `DECISIONS_PER_TASK_MAX` (200) decisions per task and
  `EXCHANGES_PER_DECISION_MAX` (200) exchanges per decision, refused by the
  writes — the bounds the live reads rely on.

## The tab is derived once, from stored facts

There is no `decisions_v` view: a live collection is served from a table,
never a view. The thread's facts are a `materializeJoin` per decision
(`decision_exchange_facts`: pending questions, unconsumed answers, the agent's
latest text — `server/internal/facts.ts`), and the tab is ONE SQL definition,
`decisionTabSql`, rendered by both the `decisions.list` window (an `expr`
field, so it filters, sorts and groups like a column) and `list_decisions`.

| tab | when |
|---|---|
| `closed` | `state = closed` |
| `sent` | an answer not consumed yet, a question not replied to, or `state = other` |
| `fyi` | `state = fyi` |
| `needs` | otherwise |

## Live reads

- **`decisionsList`** (`decisions.list`) — a window over every decision with
  `tab`, `taskTitle` (the task's current title), `pendingQuestions`,
  `unconsumedAnswers`, `latestAgentAt` and `isNew` (`seen_at` null, or the
  agent wrote since). Filter by `tab` (the inbox's tabs), `taskId` (a task's
  panel), `fromDecisionId` ("split into"); `count: true`; group by `tab` for
  the sidebar count.
- **`decisionExchanges`** (`decisions.exchanges`) — one decision's thread,
  oldest first, scoped by `decisionId`.

## The tools (`decisions.open`)

`open_decision`, `update_decision`, `list_decisions`, visible to an agent
granted `decisions.open` (the `capability` leaf; only a supervisor's root is
granted it — the supervisor preset's root scope, which a role's mandate
inherits). The logic is `server/internal/repo.ts`,
over an executor (the tools run it in a transaction; the tests in a rolled-back
one). Every refusal is a discriminated `{ ok: false, reason, message }`.

- A decision is addressed by its id (any task) or its label (the caller's
  task). Only the owning task's conversations update it; another task may name
  it as `from`.
- **A closed decision stays a record**: `update` and `reply` only, unless the
  same call sets a non-closed `state` — a reopen, which clears `outcome` and
  `closed_at`. Closing needs an `outcome`; `outcome` outside a close is
  refused.
- **Editing the text** is `edits`, the `Edit` tool's shape: each
  `{ field: question | body | option, option?, old_string, new_string,
  replace_all? }` replaces one exact, unique occurrence (all of them with
  `replace_all`), applied in order over the current text, all or none
  (`applyTextEdits`). A field rewritten whole and edited in the same call is
  refused. `read_decision` (by id, or a label of the caller's task) shows the
  current text first. `options` whole is how options are added, removed or
  re-recommended.
- Any successful update consumes the answers the user sent (ends Sent).
- **History**: the `decision` history source (`history/engine`) records a
  version after every edit, never coalesced (`coalesce: false`: each write is
  a deliberate tool call, so every state the user may have read is kept);
  before a reopen the closed version is pinned ("Before reopening"). The
  snapshot's schema is `DecisionSnapshotSchema` (core), shared by the server
  and the card: `DecisionCard`'s header steps through the versions
  (`‹ n / N ›`, `web/components/decision-versions.tsx`), a past one drawn
  read-only (its pill, question, outcome, body, options; the thread as it
  stood when the next version replaced it, unfolded — `threadAsOf`, so what
  the user typed against it stays readable once the agent rewrites the
  decision; no answer box) with Back to the current version.
  The tool checks the call first (`updateDecision(…, { dryRun: true })`), so
  a refused one pins nothing. The thread is not versioned (append-only on its
  own). A restore is the user's undo: it may reopen or close the decision,
  and keeps the current label when another decision of the task took the old
  one.

## Answering

- **Drafts are browser-only** — one kept-state work entry, `decisionDrafts`
  (`web/internal/drafts.ts`, subject `answers`), a record keyed by decision:
  `{ pick, note, close, refused }`. Every surface reads and writes the same
  entry (`useDecisionDrafts().part(id)`, one record entry as a part via
  kept-state's `keptEntry`), so a draft survives navigation and reloads and
  the inbox, the tray and the page block agree. A pick, a note or "Got it"
  only DRAFTS.
- **The note is the prompt's own editor** (`TextEditor`, one row that
  grows — the same field AskUserQuestion's answers use; not a `ComposerField`,
  which is for a field with a bar of launch controls): a pasted or dropped
  image or file, and chips (`<ui-context>`, ids) work as in any prompt, and the thread draws a note as a user turn is drawn
  (`AttachmentText`). The draft's attachments are held by the draft itself
  (paste-images' draft holds); once Submit takes a note, `takeNote`
  (`machine/internal/take-note.ts`) links what it attached to the
  decision (`decisions_attachments`, cascade) and hands the agent the note
  with each attachment ref as its disk path. The record keeps the note as
  written.
- **Answering moves on** — `DecisionCard`'s `onAnswered(via)` fires on a
  pick (`"pick"`, never an unpick) and on Enter in the note (`"note"`: the
  editor's `bare-enter` mode — Shift+Enter is a new line, ⌘↵ still reaches
  the SubmitBar). The panel opens the next row's card (the list detail's
  `openNext`); the inbox steps its list (`decisionsStepper`, as `j`). In
  the panel, moved on from the note, the next card's note takes focus
  (`autoFocusNote`); from a pick it does not. The inbox never focuses the
  next note: its keys (1–9, j / k) are the surface's, and a focused note
  would take the digits.
- **A section goes out once answered** — one agent's (task's) open
  decisions are its section (the inbox's group, the tray's panel). On an
  answered moment — a pick (click, or 1–9 in the inbox), Enter in the note,
  "Got it" / "Close without answering" turned on — `useSendAnsweredSection`
  (`web/internal/section-send.ts`, run by `DecisionCard` and the inbox's
  digit keys) sends that section in one Submit if every one of its Needs you
  and FYI decisions now holds a draft (`submitIfAllAnswered`, read as set,
  after any Submit in flight). One supervisor never waits on another's
  answers. Typing a note never sends on its own: a section whose last answer
  is a note goes on Enter. Nothing is judged while the task's decisions are
  not read whole.
- **One Submit** — `SubmitBar` (web), sticky at the foot of a list, ⌘↵ in
  its `region` (the panel whose drafts it sends, by focus only — shortcuts'
  regions: with two bars on one surface the one whose panel holds focus
  sends, with focus in neither nothing is sent; a bar alone on its surface
  takes ⌘↵ wherever focus is): "N of M answered" (M = Needs you + FYI), "x to send, y to
  keep" when some agent has finished, nothing while nothing is answered;
  `taskId` scopes it to one agent. A draft is cleared once the server took it
  (delivered or kept) and only while it still holds what was sent; a refused
  one stays with its reason (`refused`).
- **Delivery** (`POST /api/decisions/answers`, `machine/internal/answers.ts`,
  `needsMachine`: it types into agents) — per agent (task), ONE event turn
  naming every answer (`<decision-answer … pick="A">note</decision-answer>`)
  and question (`<decision-question …>`), through orchestration/message's
  `deliverEventTurn`; the exchanges commit in the transaction that records
  the turn (`onRecorded`), the turn id derived from the submission, the
  task and what it says, so a resent request records nothing twice.
  - A pick (+ note) → an `answer` exchange: the decision is **Sent** until
    the agent's next `update_decision` consumes it.
  - A note alone → a `question`: the decision is **Sent** too until the
    agent replies (`update_decision({ reply })`), then back in **Needs you**.
  - **A finished agent** (latest agent conversation `done` — `decisions.agent`,
    the task's agent: that conversation's id and whether it finished, the
    reading delivery takes) is never
    reopened: its answers are `recorded`, a pick closes the decision ("You
    chose A (not sent: the agent had finished)"), a note stays open, "Close
    without answering" settles it. The card says so before Submit and the bar
    counts it apart.
  - **"Got it"** on an FYI closes it ("Seen"), nothing delivered.
  - Refusals are per answer (`ANSWER_REFUSALS`): closed meanwhile, already
    sent (an answer not acted on yet, or the same question waiting — a second
    Submit from another tab sends nothing twice), an option gone, a close on a
    live agent's decision, no agent, a blocked resume, a full thread, a
    failed delivery (each agent's own: the others still get theirs). A turn
    recorded but not typed is `delivered` with `typingFailed` (toasted; the
    turn is retried from the conversation). A duplicate decision in one batch
    throws (a broken client). The client sends one Submit at a time.
- **Owing is enforced** (`server/internal/owing.ts`, `machine/internal/gates.ts`),
  on the task's latest agent conversation only (what answers are typed into;
  a side chat owes nothing): the
  `decisions.owed` stop gate blocks a stop while a question the user sent
  waits for a reply or an answer waits to be acted on; the
  `decisions.unsettled` exit_clean precondition also refuses while a
  `decision` / `action` still waits on the user (an answer after the exit
  would only be kept) — close it, or `flag_raise`. Not for a hand-over
  (`CleanExitKind.handedOver`: a supervisor's `handoff`), which moves the
  task's open decisions to the successor session's root
  (`handOverDecisions`, run by supervisor-roles/sessions/handoff's carry). Both hold only an agent
  granted `decisions.open`: one without the tools (a task that opened
  decisions before its mandate stopped granting them) cannot settle them,
  so it owes nothing.

<!-- AUTOGENERATED:BEGIN — do not edit; regenerated by `./equin build` -->

## Plugin reference

- Description: Agent decisions, web half: registers the dec and dex id kinds, and the pieces every decision surface shares — DecisionCard (one decision in full: label, state pill, new mark, lineage, question, outcome or Split into, markdown body, one-sentence options with a muted Recommended, the latest exchange with earlier ones folded), decisionPresentation (the pill a state wears) and useMarkDecisionSeen; answering — the drafted answers (decisionDrafts: one browser-only kept work entry keyed by decision, shared by every surface; useDecisionDrafts' part(id) and submit), each agent's section sent on its own the moment all its open decisions are answered (useSendAnsweredSection: a pick, Enter in the note, Got it), DecisionCard answered in place given a draft (options pick, a note or a question, Got it on an FYI, Close on a finished agent's decision, which says its answer will be kept, not sent), SubmitBar — the one sticky Submit (⌘↵) sending every drafted answer, N of M answered, how many go to agents and how many are only kept — and TaskDecisionsPanel, one task's decisions as the conversation tray and the page block draw them (a header folding it, open rows expanding inline into their card, a collapsed N closed row, the Submit scoped to the task; given a side pane's toggle, an icon opening the decisions beside, the panel folding to its header while they are) and TaskDecisions, the same decisions unframed for a pane; the row fields every decision list shares (the state dot, the drafted answer). The surfaces (the inbox, the conversation tray, the page block) are its sub-plugins. Agent decisions, the record: the decisions table (one per question an agent asks the user, owned by its task, labelled D<n>, in state decision / action / fyi / other / closed with an outcome) and its append-only thread (decision_exchanges: answers, questions and the agent's replies, notes); each decision's thread facts materialized per decision (decision_exchange_facts), from which the decisions.list window derives the inbox tab (needs / sent / fyi / closed) and the new mark; decisions.exchanges, one decision's thread; the decision history source (every edit a version, the closed version pinned before a reopen); and the open_decision / update_decision / list_decisions MCP tools, granted by decisions.open — a supervisor's root only (update_decision edits a decision's question, body and option texts with Edit-style old_string/new_string edits, or rewrites a field whole; a closed decision accepts only notes and replies unless the call reopens it), and read_decision (any agent: one decision of any task in full — body, options, thread — by its id, or a label of the caller's task; what a page's <task-decisions> excerpt points to and what an agent reads before editing); POST /api/decisions/:decisionId/seen stamps seen_at when the user opens one.
- Web:
  - Slots:
    - `DecisionCardSlots.AboveAnswer`
    - `DecisionCardSlots.AnswerAction`
  - Slot contributors:
    - `DecisionCardSlots.AboveAnswer` ← `tasks.decisions.ask`
    - `DecisionCardSlots.AboveAnswer` ← `tasks.decisions.notes`
    - `DecisionCardSlots.AnswerAction` ← `tasks.decisions.ask`
    - `DecisionCardSlots.AnswerAction` ← `tasks.decisions.notes`
  - Contributes:
    - `IdKinds.Kind` "dec"
    - `IdKinds.Kind` "dex"
  - Uses: 53 symbols — full list in [REFERENCE.md](./REFERENCE.md)
    - `network/live/live-state` ×4
    - `primitives/data-view` ×4
    - `network/live` ×3
    - `primitives/collapsible` ×3
    - `conversations/conversation-view/user-message` ×2
    - `primitives/css/fill` ×2
    - `primitives/css/spacing` ×2
    - `primitives/css/text` ×2
    - `primitives/css/ui-kit` ×2
    - `primitives/kept-state` ×2
    - `primitives/link-gesture` ×2
    - `primitives/row-actions` ×2
    - `primitives/shortcuts` ×2
    - `apps-core/tabs.useSurfaceShown`
    - `conversations/conversation-view/jsonl-viewer/row-actions.rowAction`
    - `ids.IdKinds`
    - `infra/endpoints.useEndpointMutation`
    - `primitives/css/badge.Badge`
    - `primitives/css/card.Card`
    - `primitives/css/clip.Clip`
    - `primitives/css/line.Line`
    - `primitives/css/rigid.rigidClass`
    - `primitives/css/row.Row`
    - `primitives/css/scroll.Scroll`
    - `primitives/css/status-dot.StatusDot`
    - `primitives/css/sticky.Sticky`
    - `primitives/icon-button.IconButton`
    - `primitives/loading.Loading`
    - `primitives/markdown.Markdown`
    - `primitives/overlay/tooltip.Kbd`
    - `primitives/relative-time.RelativeTime`
    - `primitives/slot-render.defineRenderSlot`
    - `primitives/text-editor.TextEditor`
    - `shell/notifications.useToast`
  - Exports (types):
    - `AnsweredVia`
    - `DecisionDraft`
    - `DecisionDrafts`
    - `DecisionPresentation`
    - `DecisionsBeside`
  - Exports (values):
    - `answerOf`
    - `DecisionCard`
    - `DecisionCardSlots`
    - `decisionDraftField`
    - `decisionDrafts`
    - `decisionPillField`
    - `decisionPresentation`
    - `draftWords`
    - `EMPTY_DRAFT`
    - `isAnswerable`
    - `isDraftEmpty`
    - `NewMark`
    - `SubmitBar`
    - `TaskDecisions`
    - `TaskDecisionsPanel`
    - `useDecisionDrafts`
    - `useMarkDecisionSeen`
    - `useSendAnsweredSection`
- Server:
  - Contributes:
    - `ids.kind` "dec"
    - `ids.kind` "dex"
    - `resource.declare` "decisions.agent"
    - `resource.declare` "decisions.attachment-links"
    - `resource.declare` "decisions.attachment-links:rows"
    - `resource.declare` "decisions.exchanges"
    - `resource.declare` "decisions.exchanges:rows"
    - `resource.declare` "decisions.list"
    - `resource.declare` "decisions.list:count"
    - `resource.declare` "decisions.list:groups"
    - `resource.declare` "decisions.list:rows"
    - `derived-table` "decision_exchange_facts"
    - `mandateCapability` "decisions.open"
    - `attachments.link` "decisions"
    - `conversations.stop-gate` "decisions.owed"
    - `exitCleanPrecondition` "decisions.unsettled"
  - Uses:
    - `database.db`
    - `database.DbExecutor`
    - `database/derived-tables.DerivedTable`
    - `database/sql-projection.parsed`
    - `history/engine.defineHistorySource`
    - `history/engine.recordVersion`
    - `ids.IdKinds`
    - `infra/attachments.Attachments`
    - `infra/endpoints.HttpError`
    - `infra/endpoints.implement`
    - `infra/entities.defaultNow`
    - `infra/entities.defineEntity`
    - `infra/mcp.Mcp`
    - `network/live.serveCollection`
    - `network/live.ServeCollectionOptions`
    - `network/live/query-resource.materializeJoin`
    - `tasks/orchestration/mandate.granted`
    - `tasks/orchestration/mandate.Mandate`
    - `tasks/tasks-core._tasks`
    - `tasks/tasks-core.getConversation`
  - DB schema:
    - `plugins/tasks/plugins/decisions/server/internal/rollup-table.ts`
    - `plugins/tasks/plugins/decisions/server/internal/schema-attachments.ts`
    - `plugins/tasks/plugins/decisions/server/internal/tables.ts`
  - Exports (types):
    - `FullDecision`
    - `FullExchange`
    - `TaskDecisionsRead`
  - Exports (values):
    - `_decisionExchanges`
    - `_decisions`
    - `decisionAttrs`
    - `decisionLines`
    - `existingTaskIds`
    - `handOverDecisions`
    - `optionLines`
    - `quotedLines`
    - `readDecisionInFull`
    - `readTaskDecisionsInFull`
  - Register:
    - `defineHistorySource('decision')`
    - `mcpTool('open_decision')`
    - `mcpTool('update_decision')`
    - `mcpTool('list_decisions')`
    - `mcpTool('read_decision')`
  - Resources:
    - `decisions.agent` (push)
    - `decisions.attachment-links` (keyed)
    - `decisions.attachment-links:rows` (keyed, point)
    - `decisions.exchanges` (keyed)
    - `decisions.exchanges:rows` (keyed, point)
    - `decisions.list` (keyed, window)
    - `decisions.list:count` (push)
    - `decisions.list:groups` (push)
    - `decisions.list:rows` (keyed, point)
  - Routes: `POST /api/decisions/:decisionId/seen`
- Machine:
  - Uses:
    - `infra/endpoints.implementMachine`
    - `network/live.serveValue`
  - Routes: `POST /api/decisions/answers`
- Core:
  - Uses: 23 symbols — full list in [REFERENCE.md](./REFERENCE.md)
    - `ids` ×3
    - `fields/text/config` ×2
    - `fields` ×2
    - `infra/attachments` ×2
    - `network/live` ×2
    - `tasks/task-ids` ×2
    - `conversations/turn-ledger.turnIdKind`
    - `fields/bool/config.boolField`
    - `fields/date/config.dateField`
    - `fields/int/config.intField`
    - `fields/json/config.jsonField`
    - `infra/endpoints.defineEndpoint`
    - `infra/entities.entityRef`
    - `network/live/query-resource.compositeKey`
    - `packages/list-bound.cappedList`
    - `primitives/text-editor.PromptMarkdownSchema`
  - Exports (types):
    - `AnswerRefusalReason`
    - `DecisionAgent`
    - `DecisionAnswer`
    - `DecisionExchangeId`
    - `DecisionExchangeRow`
    - `DecisionId`
    - `DecisionOption`
    - `DecisionRow`
    - `DecisionSnapshot`
    - `DecisionState`
    - `DecisionTab`
    - `OpenDecisionState`
    - `SubmitAnswersBody`
    - `SubmitAnswersResponse`
  - Exports (values):
    - `ANSWER_NOTE_MAX`
    - `ANSWER_REFUSALS`
    - `ANSWERS_PER_SUBMIT_MAX`
    - `DECISION_HISTORY_SOURCE`
    - `DECISION_OPTIONS_MAX`
    - `DECISION_STATES`
    - `DECISION_TAB_OPTIONS`
    - `DECISION_TABS`
    - `decisionAgent`
    - `DecisionAgentSchema`
    - `DecisionAnswerSchema`
    - `decisionAttachmentLinks`
    - `decisionAttachmentLinksEntityRef`
    - `decisionExchangeFields`
    - `decisionExchangeIdKind`
    - `decisionExchanges`
    - `decisionExchangesEntityRef`
    - `decisionFields`
    - `decisionIdKind`
    - `DecisionOptionSchema`
    - `DECISIONS_PER_TASK_MAX`
    - `decisionsEntityRef`
    - `decisionsList`
    - `DecisionSnapshotSchema`
    - `EXCHANGE_KINDS`
    - `EXCHANGES_PER_DECISION_MAX`
    - `markDecisionSeenEndpoint`
    - `OPEN_DECISION_STATES`
    - `SubmitAnswersBodySchema`
    - `SubmitAnswersResponseSchema`
    - `submitDecisionAnswersEndpoint`
- Cross-plugin:
  - Uses tokens:
    - `ui/tokens/color-palette --background`
    - `ui/tokens/color-palette --border`
    - `ui/tokens/color-palette --foreground`
    - `ui/tokens/color-palette --info`
    - `ui/tokens/color-palette --muted`
    - `ui/tokens/color-palette --muted-foreground`
    - `ui/tokens/density --chrome-pad-x`
    - `ui/tokens/density --space-md`
    - `ui/tokens/density --space-sm`
    - `ui/tokens/shape --radius`
    - `ui/tokens/shape --spacing`
    - `ui/tokens/type-scale --font-weight-medium`
  - Imported by:
    - `tasks/decisions/ask`
    - `tasks/decisions/inbox`
    - `tasks/decisions/item-count`
    - `tasks/decisions/notes`
    - `tasks/decisions/page-block`
    - `tasks/decisions/tray`
    - `tasks/supervisor-roles/sessions/handoff`
  - Extended by: `tasks/decisions/notes` (table `decisions_ext_notes`)
- Sub-plugins:
  - **`ask`** — A decision's side chat, web half: a chat icon on the right of the answer's editor, beside the note's (a dot while the decision has a thread and the chat is closed), opening the chat above the answer…
  - **`capability`** — The decisions.open mandate capability as plain data. A leaf, so a mandate author (mandate-presets, reached from conversations) can grant it without a cycle through decisions, which imports…
  - **`inbox`** — The Decisions inbox in the agent manager: the Decisions sidebar entry with the count of decisions that need the user (a grouping of the derived tab), the decisions pane — one view bar over the Needs…
  - **`item-count`** — Per-row decisions chip on a conversation item: how many of its task's decisions need the user (one grouping of the Needs you tab by task, shared by every row). Nothing while zero.
  - **`notes`** — A private note on each decision, never sent to the agent: a note icon on the right of the answer's editor opens it (a dot while it has text), and the auto-saved note shows above the answer box — on…
  - **`page-block`** — The <task-decisions task="task-…"/> page block: one task's decisions on a page, drawn as the conversation tray draws them (TaskDecisionsPanel, shown even while none is open) and answered in place…
  - **`tray`** — An agent's decisions in its conversation: a tray at the end of the transcript (it scrolls with the conversation, never pinned over it) drawing the task's TaskDecisionsPanel — "N decisions need you"…

<!-- AUTOGENERATED:END -->
