# mail/cache

The Mail app's cache: mail loaded **on demand** behind the provider contract
(`mail/provider`), never a mirror of the mailbox. Design: §3–4 of
[`research/2026-11-26-apps-mail-on-demand-cache-provider.md`](../../../../../../research/2026-11-26-apps-mail-on-demand-cache-provider.md).
It never names a provider: it serves the one registered `MailProviders.Provider`
(v1: one account).

## What it serves (`core`)

- **`mailThreads`** (`mail.threads`) — a live window collection: any DataView
  view's threads, newest first by `date`, filtered by a `MailQuery`, read as
  key-range pages cut on `(date, id)`.
  - The listed fields are exactly the contract's query columns (`subject`,
    `from`, `to`, `date`, `mailboxes`, `unread`, `starred`, `hasAttachment`,
    `query`), so a view's filter IS a `MailQuery`. Every one is answered by the
    provider (or re-checked per message by the cache) — never over the row's
    values: a row shows its thread, the filter asks about its messages.
  - **`date` is the thread's latest message matching the read's filter** —
    where the thread sits in the provider's date order (the query is per
    message). Read by id (`{ id }`, `{ ids }`), no filter applies: the latest
    message.
  - `query` is the search box (`searchable: ["query"]`): provider syntax,
    always null on a row.
  - **Refusals** (`MAIL_THREADS_REFUSALS`, read as the error arm's
    `kind: "refused"` + `code`): `not-connected` (render the provider's
    connect action), `offline-not-cached` (a covered window still answers
    offline), `filter-refused` (a rule the provider cannot run, named in the
    message). Never an empty list.
  - Sort is date only; no `count` (the provider gives estimates).
  - **A page is 25 threads** (`MAIL_THREADS_PAGE`): one screen. A cold page
    costs one provider summary per row (Gmail: 40 units each, 98% of a cold
    page). So each row read past what is on screen takes room from the next
    cold view's minute. A taller screen reads its next page at once; the rows
    below it are read only when they are scrolled to.
  - **A read by id answers from the cache only**: a thread never listed (or
    evicted) is absent. Fine for rows a window just showed; the reader opens
    any thread id through `mailCache.thread` (below).
- **`mailMailboxes`** (`mail.mailboxes`) — every mailbox, whole (`all`), with
  the provider's exact counts (`threadsTotal`, `threadsUnread`): the sidebar.
  Refused like `mail.threads` (`not-connected`, `offline-not-cached`).
- **`mailboxViewFilter(id, mailboxes)`** / `mailboxViewIds` — a mailbox's
  view. Whether a parent label's view includes its sub-labels is decided once
  here (`PARENT_VIEW_INCLUDES_SUB_LABELS`, design D10, pending with the
  user). Gmail's `label:Parent` never includes them, so a yes is spelled as
  the sub-labels' ids in the `hasAny`.

## How a window is answered (`server/internal/engine.ts`)

- **Tables** (`server/internal/tables.ts`, all keyed by account, all left out
  of forks, backups and the change feed): `mail_accounts` (provider, address,
  change cursor), `mail_mailboxes`, `mail_threads` (one `ThreadSummary` each,
  `stale`, `last_used_at`), `mail_queries` (one per compiled query: coverage
  `floor_at` / `exhausted`, `verified_cursor`, `locally_maintained`,
  `is_search`), `mail_query_members` (`query`, `thread`, `at`),
  `mail_thread_bodies` (a thread's content, its message ids, its weight,
  `fetched_at` / `opened_at`: below).
- **Coverage.** A query's members are complete for every thread whose latest
  matching message is after `floor_at` (all once `exhausted`). A window inside
  it is answered from Postgres alone.
- **Fill.** Past coverage, the window stays loading while the cache reads the
  provider's message list (`listMessages`: newest first by the provider's
  clock, each hit naming its thread) from `floor_at + listOrderSlackMs` down:
  each hit is placed by its message's date in the thread's summary — fetched
  only when not cached, stale, or missing that message (so a page whose
  threads did not move costs one list call) — and the floor moves to the last
  placed message plus the slack. The slack (Gmail: 60 s; measured −9 s…+12 s
  between Gmail's search clock and `internalDate`) is why a skewed message is
  never missed. Each batch commits, so a fill cut short resumes at its cut.
- **Freshness.** Summaries are current at the account's change cursor. A
  background **catch-up** (the sync step below: after each read, and on the
  change signal) reads
  `changesSince`, re-reads the changed threads (bounded: past 200 cached ones
  they are marked stale, past 50 new ones the local queries re-list) and
  re-checks every **locally maintained** query per message
  (`localMatchAt`: columns `mailboxes`, `unread`, `starred` only — `date` is
  provider-evaluated, Gmail's clock is not `internalDate`). A reset marks every
  summary stale and every query unverified. An unverified query answers from
  the cache and is **re-listed** in the background from the head to its floor,
  notifying when anything moved.
- **The account.** `connectedAccount()` names it on every read; a different
  address than the row's deletes the account's cache (another mailbox). When
  the connection cannot be checked (`unreachable`: offline, a token refresh
  failed) the account the cache holds is served — covered windows answer,
  uncovered ones are refused `offline-not-cached`.
- **Concurrency.** A fill, a re-list's write and a catch-up's re-check of
  one query run under that query's lock. A re-list reads the provider OUTSIDE
  it (its calls are background, paced behind every foreground one — under the
  lock a person's read of the same query waited 27 s on it) and writes only
  if the query's coverage and verified cursor are as it found them (else its
  next read re-lists it), leaving a thread with a triage op still pending as
  the op's re-check placed it; a catch-up keeps verified only a query
  verified exactly at the cursor it started from (any other is unverified,
  so re-listed).
- **Spam and trash are mail like any other.** The contract's query is over
  every message (the Gmail provider lists with `includeSpamTrash`), so an
  unfiltered or Unread view holds trashed threads unless its filter says
  `mailboxes hasNone [role:trash, role:spam]` — the authored views of step 3b
  should.
- **Eviction** (`server/internal/retention.ts`): queries unread 30 days
  (searches: 1), threads no query holds and unused 30 days.

## How changes arrive (`server/internal/sync.ts`, design §5)

- **One sync step per account**, coalesced (`createKeyedCoalescer`: one
  running, one trailing) and serialised: `changesSince(cursor)` applied as
  the catch-up above — changed threads re-read, locally maintained queries
  re-checked per message (in / out), the others unverified (their next read
  re-lists them), `reset` marking everything stale — then
  `mail.threads` notified with the changed ids and, when the provider says
  mailboxes moved (Gmail: any change; `relist`), `mail.mailboxes` relisted
  with fresh counts.
- **The change signal** is the provider's `push` when it is live (Gmail:
  Pub/Sub, `providers/gmail`): every change it signals runs a sync step, and
  push going live runs one (catching up what moved while it was not).
- **The fallback is the no-polling rule's documented exception**, for when
  push is none, not set up (in a worktree that did not set it up), starting
  or down:
  - `mail.sync-tick` (a `defineTimer`, exempted in `exempt/index.ts`): every
    30 s while anyone is subscribed to `mail.threads` (`whileSubscribed`) and
    push is not live (`reconcileTick` in `served.ts`, re-run on every push
    state move). Cost when nothing moved: one `history.list`, 2 units.
  - `mail.sync-idle` (a `defineJob`, every 10 min, main only), whatever push
    says: keeps the cursor inside Gmail's history window with nobody
    watching, and catches a notification Google dropped (it says push may).
  - A read still triggers a step, so a view opened between ticks is current.
- **A step's effects land before its page's cursor** (the mailbox relist
  included), so a step failing mid-way re-reads that page next time; the
  threads it already moved are notified whatever fails after. Cost: a step
  where nothing moved is one `history.list` (2 units); one where mail moved
  adds the changed threads' summaries (`threads.get` metadata, 40 units
  each) and, Gmail reporting counts moved on every change, the mailbox
  relist (`labels.list` + one `labels.get` per label: ~44 units on a
  43-label account).
- **`mail.account-status`** (`core`), read from the account row alone —
  the connection AS THE LAST STEP FOUND IT (the connection has no change
  signal; the next read, tick or idle job records a reconnect or a
  revocation): `none` (no account read yet — the health row is absent),
  `not-connected` (needs reconsent), or `account` (connected / offline,
  the change signal — push state, whether the fallback ticks — `syncedAt`, and the later step's
  `syncFailure`: offline and not-connected recorded, a fault recorded and
  reported). Pushed on every step, tick start / stop and push state move.
- **The health report's Mail row** (`web`): attention while not connected,
  a step faulted, or push is set up but down; grey while offline; ok once
  synced, saying how changes arrive (instant updates, or the fallback and
  why).

## Thread content: the reader's bodies (`server/internal/bodies.ts`, design §3)

- **`mailCache.thread(id)`** (server barrel; the reader's `mail.thread`
  serves it): the thread's summary (cached and not stale, else re-read — so
  any id, listed or not) and its content. The content comes from
  `mail_thread_bodies` while it holds **exactly the summary's messages**
  (`bodyAnswers`): a flag or label moves Gmail's thread version but no byte
  of a message, so a read or relabelled thread is never re-fetched — the
  summary's per-message facts are laid over the stored content
  (`readerContent`). A reply, a deleted message or a saved draft (a new
  message id) makes it stale: fetched again (`getThreadContent`,
  foreground). One flight per thread (`createInflight`): an open joins the
  prefetch of the same thread.
- Unavailable is typed (`MailThreadUnavailableError`): `gone`,
  `not-connected`, `offline-not-cached` (offline with no current stored body;
  a stored one still answers offline).
- **`mailCache.attachment(thread, message, part)`**: the part's description
  from the body, its bytes from the provider.
- **Byte budget**: Settings → Config `mail-cache` › Message body budget (500 MB, the user's call; `MAIL_BODY_BUDGET_BYTES` without config), read per store. Each
  store evicts the least recently opened bodies past it (a prefetched,
  never-opened one by when it was fetched); an evicted body is fetched again
  on its next open. Bodies cascade with their thread (retention, gone).
- **Prefetch** (`deps.prefetch`; Settings → Config `mail-cache` › Bodies
  prefetched per run, 25 — paced into Gmail's background share, what a minute
  leaves after the provider's foreground reserve of four cold views;
  0 turns it off): after every window read, thread open and
  sync step that moved mail, one coalesced run per account fetches, through
  the provider's **background** priority, the wanted bodies not stored, most
  wanted first: the open thread's ±3 neighbours in the view it was opened
  from (the most recently read query holding it), the Inbox's unread first
  page (25), the head (25) of every view read in the last day. A stale
  summary is skipped (re-read when listed or opened).

## Triage: the cache first, the provider after (design §6)

- **The ops** (`core/internal/ops.ts`, `MailThreadOp`): `archive` (Done),
  `move-to-inbox` (out of trash and spam too), `trash`, `spam`, `not-spam`,
  `read` (`unread` true / false), `labels` (`add` / `remove`, roles
  included). Each SETS a state (a replay is harmless). `applyMailOp` is the
  ONE reducer: the server applies it per message, the browser to the row
  (the union over messages — every op acts on every message alike, so the
  two agree). `undoMailOp(op, before)` gives the inverse as `labels` / `read`
  ops per thread as it was, grouped; `primaryMailAction(mailboxes)` the
  thread's first action (Done / Restore / Not spam / Move to Inbox).
- **`POST /api/mail/threads/apply`** (`applyMailThreadOp`, ≤ 1,000 ids) →
  `mailCache.apply(ids, op)`, answering the ops that undo it (each thread as
  the cache held it before — the browser's Undo sends them):
  1. a thread not cached is read first (its messages are what the write
     acts on);
  2. the op is **pending** on its threads until its provider write lands:
     every summary read from the provider meanwhile (`fetchSummaries`: a sync
     step, a fill) has it laid over, so a re-read of the pre-op state never
     undoes the prediction (in memory: a restart forgets it, and the next
     sync after the write lands corrects any bounce);
  3. the summaries are rewritten as the op leaves them in one transaction,
     rows locked (`FOR UPDATE`: a concurrent upsert waits, then lays the
     pending op over what it read);
  4. the provider's write is queued — **`mail.apply-op`** (`defineJob`,
     `serial` so ops land in the order made; offline or not connected:
     retried, 8 attempts; any other refusal: `NonRetryableError`, so one
     doomed op never holds the ones behind it) — before anything is shown;
  5. every verified locally maintained query re-checked per message (an
     archived thread leaves the Inbox, enters Done) — NOT under the query's
     lock: a fill holds it across paced provider calls, and a click waited
     43.6 s on the Done view's cold fill before this; the race left (a fill
     that read the pre-op summary) is undone by the next sync's re-check —
     every provider-evaluated query holding one unverified, `mail.threads`
     notified.
  - Given up (`onDead`): reported, and — database only, as it likely gave up
    offline — the threads marked stale and every query unverified, so the
    next read re-lists from the provider and the truth replaces the
    prediction.
- **The provider writes per message** (`MailWriteTarget`: a thread and its
  summary's message ids): Gmail answers one `messages.batchModify` per 1,000
  messages (50 units; a per-thread modify is 10 a thread).
- **Labels**: `POST /api/mail/labels` (`{ path }`: "Travel/Ski 2027", each
  missing level created under the one before, answers the last level's id;
  or `{ name, parentId }`, one label under a known parent), `PATCH
  /api/mail/labels/:id` (`MailLabelChange`: a rename, a move to another
  parent, or a colour — a background of the provider's palette, mapped to
  its pair here, or null to clear where the provider can), `DELETE
  /api/mail/labels/:id` (its sub-labels move up) — each through the
  provider, then the mailboxes relisted. A provider's `MailRefusedError` (a
  name taken, a move under itself, a colour off the palette) is a 400. Not
  optimistic: the tag picker shows the relisted tree. The account status
  carries the provider's `mailboxColors` for the picker's palette.
- **Undo is per thread, not per message**: it restores the thread's union
  facts on every message (Undo Done puts INBOX on each message of the
  thread, Undo mark-read marks each unread).

## Opening Mail: the Inbox in the first frame

`mailThreadsServed` declares `preloadWindows` (network/live): the Inbox's
first page (`mailInboxView`, THE Inbox definition the thread list's Inbox view
reads) rides Mail's own boot snapshot — only a page under `/mail` — answered by
`held(q)`: the one stored account, its cached mailboxes and the query's
coverage, from Postgres alone. No provider call, not even the connection check
(a token refresh can reach Google); anything not covered is `{ held: false }`
and the list loads as before; it writes nothing. Not checking the connection,
it answers for the account the cache last served: after a disconnect or a
switch to another Google account, those rows show for the instant until the
live read refuses `not-connected` or answers the new account.
`core/internal/mailbox-view.test.ts` pins that a
DataView's one-rule Inbox filter encodes to the preloaded tuple.

## Not yet (later steps of the design)

- No cap on the number of cached summaries yet (design: ~50k): threads go by retention (30 days unused, no query holding them).
- No `preload: "boot"` (its boot tuple would be the unfiltered default
  window, on every app's boot): the Inbox is preloaded instead (above).

## Testing

`server/internal/engine.test.ts` drives the engine on a throwaway database
(`createTestDb` + the real migrations) over the fake provider
(`provider/server/testing`): cut mapping, exhaustion, the skip of current
summaries, membership re-check, reset, refusals. `bodies.test.ts`: the
reader's bodies — stored and reused across flag changes, stale on a reply,
offline, the byte budget, prefetch (background priority, neighbours first).

<!-- AUTOGENERATED:BEGIN — do not edit; regenerated by `./equin build` -->

## Plugin reference

- Description: The Mail cache, browser half: the health report's Mail row (absent until Mail has been opened with an account) — attention while the account needs reconnecting, the last sync step failed or push is set up but down, grey while offline (cached mail still shown), ok once synced, saying how changes arrive (instant updates by push, or the fallback tick and why).; registers the cache's budgets (message body budget, bodies prefetched per run) for Settings → Config. The Mail cache, server half: the mail_* tables (one account, its mailboxes, cached thread summaries, per-query coverage and members), mail.threads served external — a window answered from coverage, else filled from the provider's date-ordered message list (cut at the coverage floor widened by the provider's declared clock slack, summaries fetched only when not cached, stale or missing the listed message), one sync step per account (coalesced: a read's catch-up, every change the provider's push signals, a 30 s tick while any mail view is subscribed and push is not live — the documented no-polling exception — and a 10-min job on main) applying the provider's changes since the cursor, re-checking locally maintained queries per message and re-listing the others, notifying open windows and relisting the mailbox counts, a reset marking everything stale — mail.account-status (connection, change signal — push state and whether the fallback ticks — last sync and its failure), refused typed when not connected / offline and not cached / a filter rule the provider cannot run — mail.mailboxes with the provider's counts, and the eviction sweeps — and triage (POST /api/mail/threads/apply): an op (Done, read / unread, labels, trash, spam, move to Inbox) written into the cache first (each message as the op leaves it, the locally maintained queries re-checked, the windows notified), then to the provider by the durable mail.apply-op job (serial, retried; given up, the threads re-read from the provider) — and label create (a / path, missing levels made), rename and delete.
- Web:
  - Contributes:
    - `ConfigV2.WebRegister` "mail-cache"
    - `HealthReport.Row` "Mail"
  - Uses:
    - `config_v2.ConfigV2`
    - `network/live.useLive`
    - `shell/health-report.HealthReport`
- Server:
  - Contributes: 24 contributions — full list in [REFERENCE.md](./REFERENCE.md)
    - `backup-data-exclusion` ×6
    - `change-feed-exclusion` ×6
    - `fork-data-exclusion` ×6
    - `resource.declare` ×5
    - `ConfigV2.Register` "mail-cache"
  - Uses:
    - `apps/mail/provider.MailProviders`
    - `config_v2.ConfigV2`
    - `config_v2.getConfig`
    - `database.db`
    - `database.Db`
    - `database.writeAtomically`
    - `database/admin.ExcludeFromBackup`
    - `database/admin.ExcludeFromFork`
    - `database/sql-column.parsedJson`
    - `ids.externalIdColumn`
    - `infra/background/timer.defineTimer`
    - `infra/endpoints.HttpError`
    - `infra/endpoints.implement`
    - `infra/jobs.defineJob`
    - `infra/jobs.NonRetryableError`
    - `infra/retention.defineRetention`
    - `infra/retention.markCascadeBounded`
    - `network/live.serveCollection`
    - `network/live.serveValue`
    - `network/live/change-feed.ExcludeFromChangeFeed`
  - DB schema: `plugins/apps/plugins/mail/plugins/cache/server/internal/tables.ts`
  - Exports (types):
    - `MailAttachmentRead`
    - `MailCache`
    - `MailSender`
    - `MailThreadRead`
  - Exports (values):
    - `_mailAccounts`
    - `_mailMailboxes`
    - `_mailQueries`
    - `_mailQueryMembers`
    - `_mailThreadBodies`
    - `_mailThreads`
    - `mailCache`
    - `MailThreadUnavailableError`
    - `onMailThreadsChanged`
  - Register:
    - `defineJob('retention.mail_queries')`
    - `defineJob('retention.mail_threads')`
    - `defineTimer('mail.sync-tick')`
    - `defineJob('mail.sync-idle')`
    - `defineJob('mail.apply-op')`
  - Resources:
    - `mail.account-status` (push, notified)
    - `mail.mailboxes` (keyed)
    - `mail.mailboxes:rows` (keyed, point)
    - `mail.threads` (keyed, window)
    - `mail.threads:groups` (push)
    - `mail.threads:rows` (keyed, point)
  - Routes:
    - `POST /api/mail/threads/apply`
    - `POST /api/mail/labels`
    - `PATCH /api/mail/labels/:id`
    - `DELETE /api/mail/labels/:id`
- Core:
  - Uses:
    - `apps/mail/provider.MAIL_QUERY_OPS`
    - `apps/mail/provider.Mailbox`
    - `apps/mail/provider.MAILBOX_ROLES`
    - `apps/mail/provider.MailboxId`
    - `apps/mail/provider.roleMailboxId`
    - `apps/mail/provider.THREAD_PARTICIPANTS_MAX`
    - `config_v2.defineConfig`
    - `fields.nullable`
    - `fields/bool/config.boolField`
    - `fields/date/config.dateField`
    - `fields/int/config.intField`
    - `fields/json/config.jsonField`
    - `fields/string-list/config.stringListField`
    - `fields/text/config.enumTextField`
    - `fields/text/config.textField`
    - `infra/endpoints.defineEndpoint`
    - `network/live.liveCollection`
    - `network/live.LiveRowsCollection`
    - `network/live.liveValue`
    - `packages/list-bound.cappedList`
  - Exports (types):
    - `MailAccountStatus`
    - `MailLabelChange`
    - `MailMailboxRow`
    - `MailOpFacts`
    - `MailOpUndo`
    - `MailPrimaryAction`
    - `MailPushStatus`
    - `MailThreadOp`
    - `MailThreadRow`
    - `MailThreadsRefusal`
  - Exports (values):
    - `applyMailOp`
    - `applyMailThreadOp`
    - `createMailLabel`
    - `deleteMailLabel`
    - `inMailTrash`
    - `isMailRole`
    - `MAIL_THREADS_MAX_LIMIT`
    - `MAIL_THREADS_REFUSALS`
    - `mailAccountStatus`
    - `MailAccountStatusSchema`
    - `mailboxViewFilter`
    - `mailboxViewIds`
    - `mailCacheConfig`
    - `mailInboxView`
    - `MailLabelChangeSchema`
    - `mailMailboxes`
    - `mailOpColumns`
    - `mailOpMoves`
    - `MailOpUndoSchema`
    - `MailThreadOpSchema`
    - `mailThreads`
    - `PARENT_VIEW_INCLUDES_SUB_LABELS`
    - `primaryMailAction`
    - `undoMailOp`
    - `updateMailLabel`
- Cross-plugin:
  - Imported by:
    - `apps/mail/compose`
    - `apps/mail/reader`
    - `apps/mail/threads`
  - Endpoint callers:
    - `gmail`
    - `reader`
- Exemptions:
  - Exempts itself from: `timer/no-unlisted-timer` — `server/internal/sync.ts` (sanctioned)

<!-- AUTOGENERATED:END -->
