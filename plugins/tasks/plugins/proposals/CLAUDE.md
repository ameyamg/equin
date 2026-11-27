# proposals

Agents propose changes to records that live in main's database; the user
reviews each one on main, in the view that owns the record. Design:
[`research/2026-11-27-global-record-proposals.md`](../../../../research/2026-11-27-global-record-proposals.md).

An agent works in a worktree whose database is a fork of main's, and main is
read-only for agents (the endpoints' agent-write gate). The agent edits a record
through its own build, then `./equin propose` hands the edit to main as a
**proposal**. Nothing on main changes until the user accepts it. This plugin
names no record type, no field and no owner.

## Registering a record type (`Proposals.Type`, server)

The owner registers the type in the runtime that holds its write path. For site
feed items that is the editor's `machine/` half:

```ts
Proposals.Type({
  id: "site-feed-item",                 // PROPOSAL_TYPE_ID_PATTERN
  label: "Site feed item",
  fieldsOf: (scope) => FieldsRecord | null,          // scope = a feed
  read: (id) => { scope, values, version, updatedAt } | null,   // THIS database
  touchedSince: (since) => ids,         // created or edited at/after `since`
  apply: (target, set) => { kind: "applied" } | { kind: "refused", message },
});
```

- **`apply`** is the owner's own save, so validation and side effects run. A
  `create` target carries the record's worktree id, which becomes its id on main.
- **`version`** is opaque (the owner's `updated_at`). **`updatedAt`** says whether
  main's record moved after the worktree forked.
- A type id is registered once (`proposalTypes()` throws on a duplicate).

## The record (`proposals`, main)

One row per revision of one record from one task. Fields (`core/internal/fields.ts`):

- `type` / `scope` / `record_id` / `is_new`
- `base_version` / `base_values`: main's record when the proposal arrived. It
  is null for a new record.
- `values`: the whole record as proposed.
- `changed`: the keys it changes against the base, or against the defaults for
  a new record.
- `note`
- `author_task_id` (cascade) / `author_conversation_id` / `worktree`
- `edited_on_main_since_fork`
- `revision` / `previous_id`
- `state`: `open`, `accepted`, `rejected`, `changes-requested` or `superseded`
- `decision_note` / `decided_at`

`proposals_attachments` links every file the values reference
(`mediaAttachmentIds`), set when the proposal arrives, so the orphan sweep keeps
them. It is served as `proposals.list` (a window of 50, at most 200), scoped by
`where: { type, scope }`, plus `:rows`.

## The hand-off

`./equin propose -m "<why>" [--only <type>:<id>…]` (`cli/`) runs from the
agent's worktree. It calls its own backend's `POST /api/proposals/send` with
`$EQUIN_CONVERSATION_ID`. That backend (`server/internal/send.ts`):

1. refuses on main, and refuses a database that was not forked;
2. collects every registered type's `touchedSince(databaseForkedAt())`, or
   `only`, at most `PROPOSALS_PER_SEND_MAX`;
3. for each record, reads it, resolves its values through its fields, then:
   1. asks main which files it lacks;
   2. streams each missing one from its own blob store
      (`PUT …/attachments/:id`, `importAttachment` under the same id);
   3. posts the record (`POST …/incoming`).

Main is reached at `namespaceUrl(MAIN_WORKTREE_NAME, "", servedGatewayPort())`,
and every request carries the agent-origin headers. Main's three routes declare
**`agentWrite: "proposal"`**: each only stores a proposal that the user reviews
before anything changes.

`incoming` (`server/internal/receive.ts`) answers with one of:

- `proposed { id, revision, changed }`
- `unchanged`: same as main's record, nothing stored
- `decided { id, state }`: the same values as this task's latest proposal of
  the record, which the user already accepted or rejected. Nothing is stored,
  so a later propose of other records never offers that one again, and never
  offers to undo an Edit then accept. The agent edits it again to propose
  anew.
- `refused { message }`: an unknown type or scope, values the fields refuse, a
  file not sent first, or a conversation main does not hold

The task is resolved from the conversation (`getConversation` → `getAttempt`).
A new revision supersedes the task's open or changes-requested proposal for the
same record. Receives of one record from one task are serialized (an advisory
transaction lock; a unique `(task, type, record, revision)` index).

On the sending side, a record main refused or did not answer is that record's
`refused` outcome (the HTTP error in words). The records before it keep their
answers, and the ones after it are still tried.

## Deciding (`POST /api/proposals/:id/decide`, machine, owner only)

The machine half handles this route because it types into agents.

- An accept is recorded even if a newer revision superseded the proposal
  while it was applied: main has its values, and the newer revision's review
  says the record moved since it was proposed. Any other answer needs the
  proposal still answerable.
- `accept`: writes only the `changed` keys over main's record **now**, so a
  field the user edited meanwhile stays theirs (`acceptedSet`, core). The
  record it leaves is judged whole first.
- `accept` with `values`: the user's edited copy holds only the keys the user
  sets (the proposal's changed keys plus the ones the user edited), and
  exactly those are written.
- A new record is `create`d under its worktree id.
- A refusal from the owner keeps the proposal open and shows the sentence.
- `reject { note? }` and `request-changes { note }`.

Each decision is then typed into the author's task as an event turn
(`deliverEventTurn`; the turn id is derived from the proposal and its state):

```
<proposal-decision proposal="prp-…" type="…" record="…" decision="changes-requested">note</proposal-decision>
```

That is followed by one sentence, and for a change request, how to revise:
edit the same record again, then rerun `./equin propose`.

- A stopped agent is resumed.
- A finished one is not reopened. The answer says so (`delivery`), and the
  review toasts it.
- Delivery runs after the commit. Sending the same decision again re-tells the
  agent: the turn id is derived from the proposal, the state and the note.

## Web: the pieces an owner view embeds

- `useOpenProposals(type, scope)`: the answerable proposals (open or changes
  requested), live.
- `ProposalsDataView`: those proposals as a DataView, the owner's **Proposed**
  tab. A proposed new record is its own row. The owner adds columns over
  `values` (`extraFields`) and decides where a row opens.
- `ProposalChip`: the owner row's Proposal column.
- `ProposalReview { proposal, fields, current, renderPreview, nowLabel }`, in
  the opened record:
  - the header: who proposed it, its age, the revision, the note and the
    changed fields;
  - warnings: edited on main since the fork, or since the proposal (the
    current version ≠ `baseVersion`), and the user's own change request;
  - **now beside after accepting**, each drawn by the owner's `renderPreview`,
    or the changed fields as text without one;
  - the actions: Accept · Edit then accept (the owner's `FieldsForm` over a
    copy, then "Accept with my edits") · Request changes (a note, "Send to the
    agent") · Reject.

The first owner is the Deploy app's Feeds page
(`apps/deploy/site-feeds/editor`, the `site-feed-item` type). Its preview is
the site plugin's own card (`SiteFeeds.Feed`'s `preview`: the tips page's
`TipPreview`).

## Tests

`core/internal/diff.test.ts` (the diff and what an accept writes);
`e2e/review-roundtrip.ts` — this build plays main: proposals posted to its
`incoming` / attachment routes, reviewed and answered in Deploy → Feeds.

<!-- AUTOGENERATED:BEGIN — do not edit; regenerated by `./equin build` -->

## Plugin reference

- Description: Record proposals, the review pieces an owner view embeds where its records are shown: useOpenProposals(type, scope) — the proposals the user may still answer, read live; ProposalsDataView — them as a DataView (the owner's Proposed tab; a proposed new record its own row; the owner adds columns over the proposed values); ProposalChip — the Proposed / Changes requested chip for the owner's row; and ProposalReview — one proposal in the opened record: who proposed it and why, the changed fields, warnings when the record moved on main, the record now beside the record after accepting (drawn by the owner's preview, else the changed fields as text), and Accept / Edit then accept (the owner's FieldsForm over a copy) / Request changes (a note the agent gets) / Reject. Registers the prp id kind. Record proposals, the record and the hand-off: the Proposals.Type registry an owner plugin registers a record type into (its fields per scope, how to read one record of this database, which ones it wrote since a time, and how to apply values through the owner's own write path); the proposals table on main (one revision of one record from one agent's task: main's record as the base, the proposed values, the changed keys, the agent's note, open / accepted / rejected / changes-requested / superseded) and its attachment links, served live as proposals.list; POST /api/proposals/send on an agent's worktree (what `./equin propose` calls: every registered record this fork wrote since it was forked, its missing files streamed to main first, then the record), and main's side of it — POST /api/proposals/incoming (diffed against main's record, a new revision superseding the task's open one) and the attachment missing / import routes, declared agentWrite: proposal (a stored proposal the user reviews before anything changes).
- Web:
  - Contributes: `IdKinds.Kind` "prp"
  - Uses: 21 symbols — full list in [REFERENCE.md](./REFERENCE.md)
    - `primitives/data-view` ×5
    - `primitives/css/ui-kit` ×2
    - `config_v2/fields.FieldsForm`
    - `ids.IdKinds`
    - `infra/endpoints.useEndpointMutation`
    - `network/live.useLive`
    - `primitives/css/badge.Badge`
    - `primitives/css/card.Card`
    - `primitives/css/fill.Fill`
    - `primitives/css/grid.Grid`
    - `primitives/css/line.Line`
    - `primitives/css/spacing.Stack`
    - `primitives/css/text.Text`
    - `primitives/inline-text.InlineText`
    - `primitives/relative-time.RelativeTime`
    - `shell/notifications.useToast`
  - Exports (types):
    - `ProposalCurrent`
    - `ProposalReviewProps`
  - Exports (values):
    - `ProposalChip`
    - `ProposalReview`
    - `ProposalsDataView`
    - `useOpenProposals`
- Server:
  - Contributes:
    - `ids.kind` "prp"
    - `resource.declare` "proposals.attachment-links"
    - `resource.declare` "proposals.attachment-links:rows"
    - `resource.declare` "proposals.list"
    - `resource.declare` "proposals.list:groups"
    - `resource.declare` "proposals.list:rows"
    - `attachments.link` "proposals"
  - Uses:
    - `database.db`
    - `database/fork-point.databaseForkedAt`
    - `ids.IdKinds`
    - `infra/attachments.AttachmentBlobs`
    - `infra/attachments.AttachmentConflictError`
    - `infra/attachments.Attachments`
    - `infra/attachments.AttachmentTooLargeError`
    - `infra/attachments.getAttachment`
    - `infra/attachments.importAttachment`
    - `infra/attachments.isAttachmentId`
    - `infra/endpoints.callEndpoint`
    - `infra/endpoints.HttpError`
    - `infra/endpoints.implement`
    - `infra/endpoints.rawEndpointHandler`
    - `infra/entities.defaultNow`
    - `infra/entities.defineEntity`
    - `network/live.serveCollection`
    - `tasks/tasks-core._tasks`
    - `tasks/tasks-core.getAttempt`
    - `tasks/tasks-core.getConversation`
  - DB schema:
    - `plugins/tasks/plugins/proposals/server/internal/schema-attachments.ts`
    - `plugins/tasks/plugins/proposals/server/internal/tables.ts`
  - Exports (types):
    - `ProposalApplied`
    - `ProposalRecord`
    - `ProposalTarget`
    - `ProposalType`
  - Exports (values): `Proposals`
  - Resources:
    - `proposals.attachment-links` (keyed)
    - `proposals.attachment-links:rows` (keyed, point)
    - `proposals.list` (keyed, window)
    - `proposals.list:groups` (push)
    - `proposals.list:rows` (keyed, point)
  - Routes:
    - `POST /api/proposals/send`
    - `POST /api/proposals/incoming`
    - `POST /api/proposals/attachments/missing`
    - `PUT /api/proposals/attachments/:id`
- Machine:
  - Uses:
    - `infra/endpoints.implementMachine`
    - `infra/endpoints.machineHandler`
  - Routes: `POST /api/proposals/:id/decide`
- Core:
  - Uses: 26 symbols — full list in [REFERENCE.md](./REFERENCE.md)
    - `fields` ×3
    - `ids` ×3
    - `infra/attachments` ×3
    - `fields/text/config` ×2
    - `infra/endpoints` ×2
    - `network/live` ×2
    - `packages/list-bound` ×2
    - `tasks/task-ids` ×2
    - `fields/bool/config.boolField`
    - `fields/date/config.dateField`
    - `fields/int/config.intField`
    - `fields/json/config.jsonField`
    - `fields/string-list/config.stringListField`
    - `infra/entities.entityRef`
    - `network/live/query-resource.compositeKey`
  - Exports (types):
    - `DecideProposalBody`
    - `ProposalDelivery`
    - `ProposalId`
    - `ProposalOutcome`
    - `ProposalRow`
    - `ProposalState`
    - `ProposalValues`
  - Exports (values):
    - `acceptedSet`
    - `changedKeys`
    - `decideProposal`
    - `DecideProposalBodySchema`
    - `importProposalAttachment`
    - `jsonEqual`
    - `missingProposalAttachments`
    - `PROPOSAL_ATTACHMENTS_MAX`
    - `PROPOSAL_DELIVERIES`
    - `PROPOSAL_NOTE_MAX`
    - `PROPOSAL_STATE_META`
    - `PROPOSAL_STATES`
    - `PROPOSAL_TYPE_ID_PATTERN`
    - `proposalAttachmentLinks`
    - `proposalAttachmentLinksEntityRef`
    - `proposalFields`
    - `proposalIdKind`
    - `ProposalOutcomeSchema`
    - `PROPOSALS_PER_SEND_MAX`
    - `proposalsEntityRef`
    - `proposalsList`
    - `ProposalTypeIdSchema`
    - `ProposalValuesSchema`
    - `receiveProposal`
    - `sendProposals`
- Cross-plugin:
  - Imported by: `apps/deploy/site-feeds/editor`
- Cli:
  - Exports (types): `ProposeOptions`

<!-- AUTOGENERATED:END -->
