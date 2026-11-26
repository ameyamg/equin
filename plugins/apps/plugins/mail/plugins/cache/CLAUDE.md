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
  - **A read by id answers from the cache only**: a thread never listed (or
    evicted) is absent. Fine for rows a window just showed; a reader opening
    an arbitrary thread id wants the thread value of step 5.
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
  `is_search`), `mail_query_members` (`query`, `thread`, `at`).
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
- **Concurrency.** A fill, a re-list and a catch-up's re-check of one query
  run under that query's lock; a catch-up keeps verified only a query
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

- No thread value to notify yet (step 5's `mail.thread`).
- No `preload: "boot"` (its boot tuple would be the unfiltered default
  window, on every app's boot): the Inbox is preloaded instead (above).

## Testing

`server/internal/engine.test.ts` drives the engine on a throwaway database
(`createTestDb` + the real migrations) over the fake provider
(`provider/server/testing`): cut mapping, exhaustion, the skip of current
summaries, membership re-check, reset, refusals.

<!-- AUTOGENERATED:BEGIN — do not edit; regenerated by `./equin build` -->

## Plugin reference

- Description: The Mail cache, browser half: the health report's Mail row (absent until Mail has been opened with an account) — attention while the account needs reconnecting, the last sync step failed or push is set up but down, grey while offline (cached mail still shown), ok once synced, saying how changes arrive (instant updates by push, or the fallback tick and why). The Mail cache, server half: the mail_* tables (one account, its mailboxes, cached thread summaries, per-query coverage and members), mail.threads served external — a window answered from coverage, else filled from the provider's date-ordered message list (cut at the coverage floor widened by the provider's declared clock slack, summaries fetched only when not cached, stale or missing the listed message), one sync step per account (coalesced: a read's catch-up, every change the provider's push signals, a 30 s tick while any mail view is subscribed and push is not live — the documented no-polling exception — and a 10-min job on main) applying the provider's changes since the cursor, re-checking locally maintained queries per message and re-listing the others, notifying open windows and relisting the mailbox counts, a reset marking everything stale — mail.account-status (connection, change signal — push state and whether the fallback ticks — last sync and its failure), refused typed when not connected / offline and not cached / a filter rule the provider cannot run — mail.mailboxes with the provider's counts, and the eviction sweeps.
- Web:
  - Contributes: `HealthReport.Row` "Mail"
  - Uses:
    - `network/live.useLive`
    - `shell/health-report.HealthReport`
- Server:
  - Contributes:
    - `resource.declare` "mail.account-status"
    - `resource.declare` "mail.mailboxes"
    - `resource.declare` "mail.mailboxes:rows"
    - `resource.declare` "mail.threads"
    - `resource.declare` "mail.threads:rows"
    - `fork-data-exclusion` "mail_accounts"
    - `fork-data-exclusion` "mail_mailboxes"
    - `fork-data-exclusion` "mail_queries"
    - `fork-data-exclusion` "mail_query_members"
    - `fork-data-exclusion` "mail_threads"
    - `backup-data-exclusion` "mail_accounts"
    - `backup-data-exclusion` "mail_mailboxes"
    - `backup-data-exclusion` "mail_queries"
    - `backup-data-exclusion` "mail_query_members"
    - `backup-data-exclusion` "mail_threads"
    - `change-feed-exclusion` "mail_accounts"
    - `change-feed-exclusion` "mail_mailboxes"
    - `change-feed-exclusion` "mail_queries"
    - `change-feed-exclusion` "mail_query_members"
    - `change-feed-exclusion` "mail_threads"
  - Uses:
    - `apps/mail/provider.MailProviders`
    - `database.db`
    - `database.Db`
    - `database.writeAtomically`
    - `database/admin.ExcludeFromBackup`
    - `database/admin.ExcludeFromFork`
    - `database/sql-column.parsedJson`
    - `ids.externalIdColumn`
    - `infra/background/timer.defineTimer`
    - `infra/jobs.defineJob`
    - `infra/retention.defineRetention`
    - `infra/retention.markCascadeBounded`
    - `network/live.serveCollection`
    - `network/live.serveValue`
    - `network/live/change-feed.ExcludeFromChangeFeed`
  - DB schema: `plugins/apps/plugins/mail/plugins/cache/server/internal/tables.ts`
  - Exports (values):
    - `_mailAccounts`
    - `_mailMailboxes`
    - `_mailQueries`
    - `_mailQueryMembers`
    - `_mailThreads`
  - Register:
    - `defineJob('retention.mail_queries')`
    - `defineJob('retention.mail_threads')`
    - `defineTimer('mail.sync-tick')`
    - `defineJob('mail.sync-idle')`
  - Resources:
    - `mail.account-status` (push, notified)
    - `mail.mailboxes` (keyed)
    - `mail.mailboxes:rows` (keyed, point)
    - `mail.threads` (keyed, window)
    - `mail.threads:groups` (push)
    - `mail.threads:rows` (keyed, point)
- Core:
  - Uses:
    - `apps/mail/provider.MAIL_QUERY_OPS`
    - `apps/mail/provider.Mailbox`
    - `apps/mail/provider.MAILBOX_ROLES`
    - `apps/mail/provider.MailboxId`
    - `apps/mail/provider.roleMailboxId`
    - `apps/mail/provider.THREAD_PARTICIPANTS_MAX`
    - `fields.nullable`
    - `fields/bool/config.boolField`
    - `fields/date/config.dateField`
    - `fields/int/config.intField`
    - `fields/json/config.jsonField`
    - `fields/string-list/config.stringListField`
    - `fields/text/config.enumTextField`
    - `fields/text/config.textField`
    - `network/live.liveCollection`
    - `network/live.LiveRowsCollection`
    - `network/live.liveValue`
    - `packages/list-bound.cappedList`
  - Exports (types):
    - `MailAccountStatus`
    - `MailMailboxRow`
    - `MailPushStatus`
    - `MailThreadRow`
    - `MailThreadsRefusal`
  - Exports (values):
    - `MAIL_THREADS_MAX_LIMIT`
    - `MAIL_THREADS_REFUSALS`
    - `mailAccountStatus`
    - `MailAccountStatusSchema`
    - `mailboxViewFilter`
    - `mailboxViewIds`
    - `mailInboxView`
    - `mailMailboxes`
    - `mailThreads`
    - `PARENT_VIEW_INCLUDES_SUB_LABELS`
- Cross-plugin:
  - Imported by: `apps/mail/threads`
- Exemptions:
  - Exempts itself from: `timer/no-unlisted-timer` — `server/internal/sync.ts` (sanctioned)

<!-- AUTOGENERATED:END -->
