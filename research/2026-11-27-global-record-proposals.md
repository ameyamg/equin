# Record proposals: agents propose edits to main's records, the user reviews them in place

Task: task-1795746075-pj08r2 (parent task-1795740083-8an208, "Let agents refine
and propose tip updates"). Mockup: proto-1795745214-tbei1l?review=preview.

## Context

Agents work in worktrees. A worktree's database is a fork of main's, and main is
read-only for agents (`agentWriteGate`, 403). Content that lives only in main's
database cannot be improved by an agent at all. The first case is the website
tips (`site_feed_items`, feed `tips`, edited on Deploy → Feeds). Four
tip-rewrite tasks are waiting on this.

The user wants **one generic mechanism**, not an MCP tool per use case:

- an owner plugin registers a **record type**;
- an agent edits records of that type through the real app in its own worktree,
  then hands its edits over to main as **proposals**;
- the user reviews each proposal on main, inside the view that owns the record,
  and accepts, edits then accepts, requests changes, or rejects.

## Decisions

### 1. A record type is registered by its owner (server contribution)

`Proposals.Type` (server contribution, `tasks/proposals/server`). The owner
registers it in the runtime that holds its write path. For tips that is the
editor's `machine/` half, because a published item's save requeues its publish
job.

```ts
Proposals.Type({
  id: "site-feed-item",           // PROPOSAL_TYPE_ID_PATTERN
  label: "Site feed item",
  fieldsOf(scope) → FieldsRecord | null,     // a scope = the feed; null: unknown
  read(id) → { scope, values, version } | null,
  touchedSince(since: Date) → ids,            // written in THIS database since then
  apply(target, values) → { kind: "applied" } | { kind: "refused", message },
    // target: { kind: "edit", id } | { kind: "create", id, scope }
})
```

- **`scope`** is what picks the fields within one type. A site feed item's fields
  are its feed's. The proposals plugin names no feed and no field.
- **`version`** is an opaque string: the owner's `updated_at`. It is used for
  conflict detection.
- **`apply`** is the owner's own write path, so its validation runs. For tips this
  is `saveItemValues` (the box's judge) plus the republish of a published item;
  `create` is a new draft under the given id.

### 2. One proposal record, on main

`proposals` (`tasks/proposals/server`, a `defineEntity`, id kind `prp`):

| column | meaning |
|---|---|
| `type`, `scope`, `record_id` | what it is about. `record_id` is the record's id in the worktree; for a new record it becomes the id on main when accepted |
| `is_new` | main held no such record when it was proposed |
| `base_version`, `base_values` | main's record when it was proposed (null for new): what the review diffs against, and conflict detection |
| `values` | the proposed values (whole record) |
| `changed` | the keys `values` changes against the base (for new: every key not at its default) |
| `edited_on_main_since_fork` | main's record moved after the worktree forked. Its differences may undo the user's edits, so the review warns |
| `note` | the agent's why |
| `author_task_id`, `author_conversation_id`, `worktree` | who proposed it |
| `revision`, `previous_id` | v1, v2… of the same record from the same task; a new revision supersedes the open one |
| `state` | `open` · `accepted` · `rejected` · `changes-requested` · `superseded` |
| `decision_note`, `decided_at` | the user's answer |

`proposals_attachments` (`Attachments.defineLink`) holds every attachment the
proposed values reference, so the orphan sweep keeps them until a decision.

Served live as `proposals.list` (a window scoped `where: { type, scope }`, newest
first, `:rows` by id).

### 3. Hand-off: `./equin propose`, run from the worktree

No new MCP tool. The flow:

1. The agent edits through its own build, for example
   `http://<worktree>.localhost:<port>/deploy/feeds`, or with an e2e script.
2. The agent runs `./equin propose -m "<why>" [--only <type>:<id>]`.
3. The CLI calls its own worktree's `POST /api/proposals/send`, passing
   `{ conversationId: $EQUIN_CONVERSATION_ID, note, only? }`.
4. The **worktree server** collects every registered type's `touchedSince(databaseForkedAt())`,
   then reads each record. For each one:
   1. It asks main which of the record's attachment ids main lacks
      (`GET /api/proposals/attachments/missing`).
   2. It streams each missing one from its own blob store to main
      (`PUT /api/proposals/attachments/:id`, `importAttachment` under the same
      id, idempotent).
   3. It posts the proposal: `POST /api/proposals/incoming`.

   Main's origin is `namespaceUrl(MAIN_WORKTREE_NAME, "", servedGatewayPort())`.
   Main's routes declare **`agentWrite: "proposal"`**, a new arm of the closed
   `AgentWrite` union: *"only ever writes a proposal the user reviews before
   anything else changes"*.
5. Main validates the values against `fieldsOf(scope)` (`fieldsToZodObject`).
   It checks every referenced attachment exists, diffs the values against its
   current record, and supersedes an open proposal of the same task for the same
   record. A record with no change is answered `unchanged` and nothing is stored.
   The task is resolved from the conversation (`getConversation` →
   `getAttempt`).
6. The CLI prints one line per record: `proposed prp-… (v2) site-feed-item sfe-… title, body` · `unchanged` · `refused: …`.

`send` refuses on main (there is no fork to propose from). Each record is
answered on its own, so one refusal does not drop the rest.

### 4. Decisions reach the agent through `deliverEventTurn`

`POST /api/proposals/:id/decide` takes one of:

- `{ accept, values? }`: `values` is the user's edited copy;
- `{ reject, note? }`;
- `{ request-changes, note }`.

It is the default gate (owner only). Agents get 403 here.

- **Accept** applies the change through `type.apply`:
  - an edit applies only the `changed` keys over main's current values, so a
    field the user changed meanwhile is kept;
  - an accept with the user's edits applies every key that differs from the
    current values;
  - a new record is created under `record_id`.

  A refusal from the owner keeps the proposal open and shows the sentence.
- **Request changes** sets `changes-requested` with the note.
- **Every decision** is delivered to the author task as an event turn,
  `deliverEventTurn(author_task_id, { id: "proposal-decision:<id>", text })`,
  with text `<proposal-decision proposal="prp-…" record="…" decision="changes-requested">note</proposal-decision>`
  plus one line on how to revise (edit again, `./equin propose`). An agent that
  is already `finished` is not reopened. The decision stays on the proposal and
  the review says the agent has finished.

This deliberately does not reuse `tasks/decisions`. That is the agent asking
the user, and it is owned by a supervisor's capability with a fixed
question/options shape. Here the user answers the agent's proposal. The shared
piece is the delivery primitive, and that is what's reused.

### 5. Review UI: generic pieces the owning view embeds (`tasks/proposals/web`)

- **`useProposals(type, scope)`**: the open proposals of a scope, read live.
- **`proposalsSource(type)`**: a DataView source over `proposals.list`, used as
  the **Proposed** tab of the owner's list. It sits beside the owner's own
  source in a `DataViewSwitcher` (a queue of the same records). A proposed new
  record is its own row there.
- **`<ProposalChip proposal>`**: the "Proposed" chip the owner puts in its row
  (the items list's Proposal column).
- **`<ProposalReview proposal current renderPreview fields onDecided>`** goes in
  the opened record. It shows:
  - the header: proposed by (the task, as a chip), its age, the changed fields,
    the note, v1/v2 revisions, and the "edited on main since" / "changed since
    proposed" warnings;
  - **the preview, side by side**: "Now" and "After accepting", each drawn by the
    owner's `renderPreview(values)`;
  - Accept / Edit then accept (the owner's `FieldsForm` over a local draft, then
    "Accept with my edits") / Request changes (a note, "Send to the agent") /
    Reject;
  - the decided state, once decided.

  A **new** record has no "Now", so only "After accepting" is shown.

**The preview of a tip is the site's own card.** The tips plugin's `TipCard` is
split into a view over plain values plus a media-source resolver. The resolver
is the box's public route on the site, and the attachment route in the editor.
The view is contributed with the feed: `SiteFeeds.Feed({ feed, preview })` on
the web. The editor hands it to `ProposalReview`. The editor still names no
feed.

### 6. Placement

`plugins/tasks/plugins/proposals` (core, server, web, cli). Proposals are agent
work that the user reviews, so they live beside `decisions`. They are a new
child of the `tasks` umbrella, not a new top-level primitive.

## What a per-tip agent does (the contract for the four rewrite tasks)

1. `./equin build` (background) and wait for it.
2. Open `http://<worktree>.localhost:<port>/deploy/feeds`. The URL is printed by
   `./equin url`.
3. Open the tip and edit its title, text or media. The form autosaves. Never
   Publish: a worktree never publishes to a deployed site, and the user's accept
   republishes.
   - To add a screenshot or recording, upload it in the media field.
   - The `browser_*` MCP tools or an `e2e/` script drive the same page.
4. `./equin propose -m "<what changed and why>"`. With `--only site-feed-item:<sfe-id>`
   it proposes that tip alone. Without it, every record the agent changed is
   proposed.
5. End the turn. The user's decision arrives as a `<proposal-decision>` event
   turn:
   - `changes-requested`: edit again in the worktree, then rerun
     `./equin propose`. The new revision replaces the old one.
   - `accepted` / `rejected`: done.

## Known limits

- **Attachments.** Bytes live in the host-global blob store, keyed by id, and
  every instance shares that store (an existing property of forks). Main's import
  of a worktree's file writes the same path. A worktree deleting that attachment
  later would delete main's file too. That is a property of the shared store,
  not of proposals; it's recorded in the Backlog.
- **The diff base.** It is main's record **at proposal time**. A field the user
  changed on main after the fork, which the agent did not touch, still differs.
  The review flags those proposals (`edited_on_main_since_fork`) so the user
  reads the changed list.

## Verification

- Unit: `core/internal/diff.test.ts` (the diff, and what an accept writes).
- End to end: `e2e/review-roundtrip.ts`, on this worktree's build playing
  main. Proposals are posted to its `incoming` and attachment routes, exactly
  what a worktree's `send` posts to main. The script then checks, in Deploy →
  Feeds:
  - the Proposal chip and the Proposed tab;
  - the review, drawn by the site's own card;
  - Accept;
  - Request changes, then a v2 that supersedes it;
  - Edit then accept on a new tip;
  - Reject;
  - a decided record re-sent is not proposed again.

  It passes 15/15.
- The worktree → main transport (`send` → main's routes) can only run once
  main serves the routes, i.e. after the push. It is checked then with a real
  `./equin propose` from this worktree.

## Review changes (after two review passes)

Decided proposals are not re-proposed by a later propose (`decided`).

Receives are serialized per record: an advisory lock plus a unique revision
index.

A refused create removes its draft.

Each record's transport failure is its own `refused` outcome.

An accept is recorded even if a newer revision superseded it meanwhile.

A decision can be resent to re-tell the agent.

On the Feeds page:
- the newest proposal per record wins;
- the review follows a proposal to its newest revision;
- an accepted new item opens;
- a failed read is shown;
- a deleted item's proposal can still be answered.

Edit then accept writes only the keys the user sets.
