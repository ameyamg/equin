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
- **Freshness.** Summaries are current at the account's change cursor. After
  each read a background **catch-up** (coalesced per account) reads
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

## Not yet (later steps of the design)

- No change signal of its own: a view refreshes when read (task 4 adds the
  push / fallback tick and `mail.account-status`).
- No `preload: "boot"`: a collection's boot tuple is its param-less default
  window (unfiltered, not the Inbox), loaded for every app's first paint, and
  an uncovered one would wait on the provider.

## Testing

`server/internal/engine.test.ts` drives the engine on a throwaway database
(`createTestDb` + the real migrations) over the fake provider
(`provider/server/testing`): cut mapping, exhaustion, the skip of current
summaries, membership re-check, reset, refusals.

<!-- AUTOGENERATED:BEGIN — do not edit; regenerated by `./equin build` -->

## Plugin reference

- Description: The Mail cache, server half: the mail_* tables (one account, its mailboxes, cached thread summaries, per-query coverage and members), mail.threads served external — a window answered from coverage, else filled from the provider's date-ordered message list (cut at the coverage floor widened by the provider's declared clock slack, summaries fetched only when not cached, stale or missing the listed message), a background catch-up from the change cursor that re-checks locally maintained queries per message and re-lists the others, refused typed when not connected / offline and not cached / a filter rule the provider cannot run — mail.mailboxes with the provider's counts, and the eviction sweeps.
- Server:
  - Contributes:
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
    - `infra/retention.defineRetention`
    - `infra/retention.markCascadeBounded`
    - `network/live.serveCollection`
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
  - Resources:
    - `mail.mailboxes` (keyed)
    - `mail.mailboxes:rows` (keyed, point)
    - `mail.threads` (keyed, window)
    - `mail.threads:groups` (push)
    - `mail.threads:rows` (keyed, point)
- Core:
  - Uses:
    - `apps/mail/provider.MAILBOX_ROLES`
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
    - `packages/list-bound.cappedList`
  - Exports (types):
    - `MailMailboxRow`
    - `MailThreadRow`
    - `MailThreadsRefusal`
  - Exports (values):
    - `MAIL_THREADS_MAX_LIMIT`
    - `MAIL_THREADS_REFUSALS`
    - `mailboxViewFilter`
    - `mailboxViewIds`
    - `mailMailboxes`
    - `mailThreads`
    - `PARENT_VIEW_INCLUDES_SUB_LABELS`

<!-- AUTOGENERATED:END -->
