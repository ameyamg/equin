# Mail (rebuild): on-demand loading with a cache, behind a generic provider

**Status:** design. Nothing implemented yet.
**Task:** task-1795696150-48l8i2, part of "Rebuild mail app from scratch with data views".
**Siblings:** the old Mail app is being deleted (task-1795696132-6cmii2). The prototype
`proto-1795656296-rtsmk5` is being cut down to its default variant (task-1795696140-tyzyan).
This design does not read or reuse the old `plugins/apps/plugins/mail` code. It does take
lessons from the old research docs (listed under *Lessons* below).

## Context

The new Mail app must:

- **Feel instant.** Opening the app shows the inbox, and opening a thread shows its content.
- **Never mirror the whole mailbox.** It loads what a view asks for and caches it.
- **Sit behind a generic provider interface.** Gmail comes first, and IMAP, JMAP and Outlook
  must fit later without a redesign.
- **Ship the standard features in v1, for one account.** That means list views, reading a
  thread, full search, drafts, compose/reply/forward, send, archive/done, star, read/unread,
  labels, trash and attachments. It has no smart features and no bundles.
- **Be DataView-based throughout.** The sidebar entries are premade views (an ordinary,
  editable `filter`), and users build their own views. So the cache must answer *any* filtered,
  sorted and paged window. When a view asks for mail that is not cached, it must say so: fetch,
  show loading, and never show a misleading empty list.

### The experience we are aiming for

```ts
// web — the whole Inbox pane
<DataView source={liveDataSource(mailThreads, { searchable: ["query"] })} views={["list"]} … />
// config/mail/threads.jsonc — the sidebar is authored views, each just a filter
{ "views": [
  { "name": "Inbox",   "view": { "type": "list", "filter": { "mailboxes": { "hasAny": ["role:inbox"] } } } },
  { "name": "Starred", "view": { "type": "list", "filter": { "starred": { "is": true } } } },
  { "name": "From Ana, unread, with PDF", "view": { "type": "list", "filter": { "and": [ … ] } } }
]}
```

The user sees the following:

- **Opening the app.** The Inbox's first page is painted from the cache before the first
  frame, through a boot preload.
- **Opening a thread.** The body is usually already prefetched. If not, a skeleton shows for
  about 300 ms while it loads.
- **Typing in the search box.** Gmail's full mailbox search runs, and the rows stream in.
- **Building a view nobody opened before.** It shows loading for about a second the first
  time, and is instant after that.

### Lessons from the previous Mail app

The old design was `research/2026-06-30-apps-mail-gmail-sync-engine.md`,
`2026-07-02-mail-on-demand-search.md` and `2026-08-03-global-mail-mailbox-as-dataview-views-v2.md`.

- **The window mirror was never complete.** It was a 30-day / 1,500-message backfill plus
  `history.list`. Search had to "fold" remote results into it. So every view's emptiness was
  ambiguous: either nothing matched, or nothing was mirrored. This design replaces "a mirror
  window" with **per-query coverage**: what the cache knows *for this query*, and where that
  knowledge stops.
- **The user wants plain, editable filters.** Mailboxes are DataView tabs whose `filter` the
  user may edit, with no locked chips. Labels are a filterable field, not one view per label.
  This design keeps that ruling.

## Research summary: how fast clients do it, and what Gmail gives us

### Gmail API

Sources: the quota, sync, push and batch guides on developers.google.com/workspace/gmail.

- **Quota.** The limit is 6,000 units per user per minute (about 100 per second). Costs:
  - `threads.list` 10, `messages.list` 5, `history.list` 2.
  - `threads.get` 40 (`full` 120), `messages.get` 20 (`full`/`raw` 60).
  - `messages.send` 100, `drafts.create` 10, `drafts.update` 15, `drafts.send` 100.
  - `attachments.get` 20, `threads.modify` 10, `batchModify` 50, `watch` 100.
  - Going over returns 403 `userRateLimitExceeded` or 429, and clients back off exponentially.
- **`threads.list` / `messages.list` with `q`** take the Gmail search-box syntax, including
  `after:`/`before:` with epoch seconds.
  - `maxResults` is at most 500.
  - `threads.list` items carry `id`, `snippet` and **`historyId`**. That makes "has this
    thread changed since I cached it?" free: only the threads whose `historyId` moved need a
    `threads.get`.
  - There is no sort parameter. Results are always newest first.
- **`format=metadata` + `metadataHeaders[]`** returns labels and chosen headers without
  bodies. `full` returns the parsed MIME tree, and `raw` returns RFC 2822.
- **Batch** takes at most 100 calls per HTTP batch; Google recommends 50 or fewer. Each call
  still counts against quota.
- **`history.list(startHistoryId)`** returns `messageAdded`, `messageDeleted`, `labelAdded`
  and `labelRemoved`, at 2 units.
  - An id usually stays valid for a week or more, and occasionally for only hours.
  - An expired id returns 404, and the client must do a full resync.
- **Push.** `users.watch(topicName)` publishes to a **Cloud Pub/Sub topic** at most once per
  second per user. The watch expires after 7 days, and Google advises renewing it daily.
  Notifications can be late or dropped, so Google says to fall back to `history.list`.
  - A *push* subscription needs a public HTTPS endpoint.
  - A **pull / StreamingPull subscription needs none**. It is an outbound gRPC stream that the
    client opens.
  - Google's guide also says installed and device apps may simply poll `history.list`.

### Fast clients

- **Superhuman.** It sets a 100 ms budget per interaction. Thread metadata and content live in
  a local store, and attachments sit in a cache served by a service worker.
  - Every action is a *modifier* in a per-thread queue. It is applied locally at once and
    persisted to the server idempotently with retries. A modifier that fails permanently is
    dropped, and the view recomputes from the cache plus the remaining modifiers.
  - Takeaway: **optimistic, durable, idempotent ops**, and **bodies prefetched**.
- **Gmail web / Mimestream.** Both are thin over Gmail's own server search, with the recent
  list and bodies for likely-next threads prefetched. Mimestream is native over the Gmail API
  (no IMAP), which is the same position we are in.
  - These internals are not publicly documented; this is folklore.
- **JMAP (RFC 8620/8621).** It is the cleanest model to borrow for the provider interface:
  - per-type `state` strings, and `Email/changes(sinceState)` returning created, updated and
    destroyed, or `cannotCalculateChanges`, which means reset;
  - `Email/query` + `queryState` / `Email/queryChanges` for *query-result* deltas;
  - mailboxes with roles (`inbox`, `sent`, `drafts`, `trash`, `junk`, `archive`) plus keywords
    (`$seen`, `$flagged`, `$draft`);
  - push over EventSource.
- **IMAP CONDSTORE/QRESYNC.** Each message has a MODSEQ, read back with `CHANGEDSINCE`, and
  expunges come back as `VANISHED`. A changed UIDVALIDITY means reset.
  - Takeaway: every provider has an **opaque change cursor with a "reset" outcome**.

### What applies here

1. **The provider is the source of truth for membership and search.** We never evaluate
   "which threads match" ourselves over an incomplete cache, so the cache cannot make a view
   look emptier than it is.
2. **The cache remembers what it knows, query by query.** This follows JMAP's query state
   (*Coverage* below).
3. **One change cursor per account with a reset outcome.** That is `historyId`, a JMAP
   `state` or an IMAP modseq, and it keeps the cache honest cheaply.
4. **Use `historyId` per thread on list results** so a revalidation costs about 10 units, not
   N×40.
5. **Prefetch bodies for the likely-next threads.** These are the top of the open view, the
   unread threads, and the neighbours of the thread being read.
6. **Optimistic, durable, idempotent writes**, with undo by inverse op and undo-send by
   delaying the send.

## Design

### 1. Data model: provider-neutral, JMAP-shaped

`mail/plugins/provider/core`:

```ts
type MailboxRole = "inbox" | "sent" | "drafts" | "trash" | "spam" | "archive" | "important" | "all";
type Mailbox = { id: MailboxId; name: string; role: MailboxRole | null; kind: "system" | "user";
                 parentId: MailboxId | null; counts: { threads: number; unread: number } | null };

type ThreadSummary = {                       // one list row
  id: ThreadId; version: string;             // Gmail: thread historyId; JMAP: state; IMAP: max modseq
  subject: string; snippet: string;
  participants: Participant[];               // capped list
  lastMessageAt: Date; messageCount: number;
  mailboxIds: MailboxId[];                   // Gmail labels; IMAP: the folder(s)
  unread: boolean; starred: boolean; hasAttachments: boolean; hasDraft: boolean;
};
type ThreadContent = { id; version; messages: MessageContent[] };   // headers, text, html, attachment metas
```

- **Gmail labels map to `mailboxIds`.** `UNREAD` becomes `unread: true`, and
  `STARRED` becomes `starred: true`. Neither is a mailbox, as in JMAP keywords.
- **IMAP folders are mailboxes too.** A message is in exactly one, and the provider says so
  through its capabilities.
- **Rows are threads in v1** (Gmail's conversation view). A message-row view is a later
  addition, not a redesign: `MessageSummary` would come through the same coverage machinery
  under a second collection.

### 2. The provider interface

`mail/plugins/provider/core` holds the contract. The server half registers implementations.

```ts
interface MailProvider {
  readonly id: ProviderId;                                  // "gmail"
  readonly capabilities: { mailboxModel: "labels" | "folders"; serverSearch: true;
                           threadVersion: boolean; push: "pubsub" | "eventsource" | "idle" | "none" };

  // — reads —
  compileQuery(q: MailQuery): { ok: true; providerQuery: string }
                            | { ok: false; unsupported: FilterClausePath };  // refusal, never a guess
  listThreads(providerQuery: string, page: { olderThan: SortCut | null; limit: number })
    : Promise<{ refs: { id: ThreadId; version: string }[]; exhausted: boolean }>;
  getThreads(ids: ThreadId[]): Promise<ThreadSummary[]>;   // batched inside
  getThreadContent(id: ThreadId): Promise<ThreadContent>;
  getAttachment(ref: AttachmentRef): Promise<Uint8Array>;
  listMailboxes(): Promise<Mailbox[]>;

  // — changes —
  currentCursor(): Promise<ChangeCursor>;
  changesSince(c: ChangeCursor): Promise<
    | { kind: "changes"; threads: { changed: ThreadId[]; removed: ThreadId[] }; mailboxesChanged: boolean; next: ChangeCursor }
    | { kind: "reset" }>;                                   // 404 / cannotCalculateChanges / UIDVALIDITY
  watch?(onSignal: () => void): Promise<Disposable>;       // push; absent ⇒ fallback (§6)

  // — writes: semantic, so IMAP never fakes label math —
  archive(ids): Promise<void>;  moveToInbox(ids); trash(ids); untrash(ids); deleteForever(ids);
  setFlags(ids, { unread?: boolean; starred?: boolean });
  setMailboxes(ids, { add: MailboxId[]; remove: MailboxId[] });
  createMailbox / renameMailbox / deleteMailbox;
  saveDraft(d: DraftInput, existing: ProviderDraftId | null): Promise<ProviderDraftId>;
  deleteDraft(id); send(m: OutgoingMessage): Promise<{ messageId; threadId }>;
}
```

- **`MailQuery`** is the live filter language's `Filter` tree, from
  `network/live/plugins/filter`, over the `ThreadSummary` fields, plus a free-text `query`
  term. Every provider compiles the same tree:
  - Gmail builds a `q` string;
  - JMAP builds an `Email/query` FilterCondition;
  - IMAP builds a `SEARCH` key list.
- **A clause the provider cannot express is refused.** It surfaces as the DataView's
  `UnavailableFilterRuleError` for that rule. We never post-filter it locally over partial
  data.
- **The filter UI offers only what can be compiled.** Each field declares only the operators
  that every registered provider compiles, so an unsupported rule normally has no spelling at
  all (rung 1). The refusal is the guard for saved views.
- **Writes are semantic.** "Archive" removes `INBOX` on Gmail and moves the thread to the
  Archive mailbox on IMAP. The UI calls `archive`, never the label math.
- **Registration.** Providers are an open set: a `MailProviders.Provider` server contribution,
  with the account row naming its `providerId`. The cache and the UI use only the interface
  (collection–consumer separation). v1 registers one provider.

### 3. What is stored

The cache lives in Postgres on the backend. Tables are keyed by `account_id`, which is
v1-singular but costs nothing.

| Table | Holds | Bound |
|---|---|---|
| `mail_accounts` | provider id, address, **change cursor** (`historyId`), push state | 1 row in v1 |
| `mail_mailboxes` | every mailbox/label + counts | whole set (`all`, a few hundred at most) |
| `mail_threads` | `ThreadSummary` rows (≈1 KB each) + `fetched_at`, `last_used_at` | LRU, ~50k rows (~50 MB) |
| `mail_queries` | one row per distinct compiled query: `provider_query`, `locally_maintained` flag, **coverage** (`floor_key`, `exhausted`), `verified_cursor`, `last_read_at` | LRU, days |
| `mail_query_members` | (`query_id`, `thread_id`, `sort_key`) — the ordered result set as far as covered | per query, to its floor |
| `mail_thread_bodies` | `ThreadContent` for a `version` (+ bytes, `last_opened_at`) | LRU by bytes, default 500 MB |
| attachments | through `infra/attachments` (`importAttachment`), fetched on first open | the attachments sweep + our LRU |
| `mail_drafts` | the **local working copy** of each draft + provider draft id + revision | the user's drafts |
| `mail_outbox` | queued sends (MIME ref, `send_at`, state) | small |

**Prefetch policy.**

- **Metadata** is never fetched for its own sake. It arrives as part of answering a window.
- **Bodies** are prefetched by a low-priority job:
  - the top 25 threads of every view read in the last day;
  - every unread thread on the Inbox's first page;
  - ±3 neighbours of the thread being read.
  - It runs through the quota pacer, so it never starves a foreground read.

**Eviction** is one scheduled retention job (`infra/retention`):

1. Queries unread for 30 days (search queries after 1 day) lose their members and coverage.
2. Threads that no query references and that have not been used for 30 days are deleted.
3. Bodies over the byte budget are evicted, least recently opened first. A body is re-fetched
   on its next open, so eviction only costs latency.

### 4. Coverage: how the cache answers any DataView window without a mirror

A DataView window is `(where, orderBy, after, limit)`. It is served by the live API's
**external arm**: `serveCollection(mailThreads, { source: "external", changes: "notified", window, rows })`
(`network/live/CLAUDE.md`, "The external arm"). Its loader may block on the provider, so the
window simply stays `loading` while mail is fetched. The DataView draws its skeleton, never
`[]`.

`window(q)` works like this:

```
query  = upsertQuery(compileQuery(q.where))             // refused ⇒ UnavailableFilterRuleError
need   = rows of `query` strictly after q.after, up to q.limit
if coverage(query) reaches past `need` (floor below it, or exhausted)
     and query is fresh (verified_cursor = account cursor, or locally maintained):
     answer from mail_query_members ⋈ mail_threads        // pure SQL, ~ms
else fill(query, from = q.after ?? head, until = limit rows found or exhausted):
     refs   = provider.listThreads(providerQuery, { olderThan: cut(q.after), limit })
     stale  = refs whose version ≠ cached mail_threads.version (or not cached)
     upsert provider.getThreads(stale)                    // batched ≤50, paced
     write members, extend floor_key / exhausted, stamp verified_cursor
     answer
```

- **Key-range pages map onto Gmail.** Live windows page by key ranges, not tokens. Gmail has
  no cursor we can cut at, but it does have `before:<epoch>`.
  - The sort key is (`lastMessageAt` desc, `id`), and `cut(after)` becomes
    `providerQuery + " before:<sec+1>"`.
  - The loader drops refs at or before the cut key and keeps paging with `pageToken` *within
    one fill* until `limit` rows are found or the results are exhausted.
  - Gmail's `before:` matches any message of a thread, so it can return threads newer than the
    cut. The key filter removes them.
- **Sorting is by date only.** The only sortable field is `lastMessageAt` descending, which is
  the provider's own order.
  - Sort by sender or subject is **not offered**, because no provider can page it server-side
    without a full mirror. It is declared non-sortable, so it has no spelling.
  - Grouping by a date bucket is exact, because DataView's `monotone` grouping is checked
    against the paged order. Grouping by label or sender sections only the loaded rows and
    shows `N+`.
- **Counts.** The window declares no `count`. Gmail's `resultSizeEstimate` is an estimate, not
  a count.
  - Sidebar badges come from `mail_mailboxes.counts` (Gmail `labels.get`: `threadsUnread` /
    `threadsTotal`), which are exact for mailbox views.
  - The DataView shows `N+` while the read can still grow.
- **Search.** The search box is the `query` column. `searchable: ["query"]` lowers it to a
  `contains(query, text)` clause, which Gmail compiles to raw `q` text. So the full Gmail
  operator language works (`from:ana has:attachment older_than:1y`), over the **whole mailbox,
  server-side**.
  - There is no local full-text index. It could only find cached mail, which is exactly the
    misleading-partial answer we are avoiding.
  - Each search is a query row with a 1-day LRU.
- **Freshness of a covered query.** There are two classes, set when the query is compiled:
  - **Locally maintained.** The filter uses only fields the cache holds exactly (mailboxes,
    unread, starred, hasAttachments, a date range): every sidebar view, and most user-built
    ones.
    - The sync engine (§5) re-evaluates membership itself with `matchesFilter` on each changed
      thread. It inserts the thread above the floor, or removes it.
    - These queries stay fresh with **zero** provider calls, so reopening the Inbox is pure
      SQL.
  - **Provider-evaluated.** Free text, `from:`/`subject:` contains, and other provider
    semantics.
    - A change since `verified_cursor` marks the head stale. The next read answers from the
      cache *immediately*, re-lists the head in the background, diffs it, and calls
      `notify()` if anything moved.
    - Stale-while-revalidate is allowed here because the rows shown are real rows of the
      query as of a known cursor, never manufactured ones.
- **Instant open.** `mailThreads` declares `preload: "boot"`, so the default window (the
  Inbox's first page, from coverage) is hydrated before first paint. The code path passes
  `preload` through `serve-on.ts`; task 3 verifies it end to end for an external collection.
- **Thread content** is a param'd `liveValue("mail.thread", { id })`, external,
  `changes: "notified"`. Its loader returns the cached body when `version` matches the
  summary's, and otherwise fetches `full`, parses, stores and returns. While it fetches, the
  read is `loading`.
- **Rendering.** The HTML goes into `InlineFrame`, an opaque `srcdoc` with no same-origin and
  no scripts (`primitives/embed/plugins/frame`).
  - `cid:` images are rewritten with `infra/html-decode` to attachment URLs.
  - Remote images go through a server proxy built on `infra/safe-fetch`, so the user's IP is
    never exposed.

### 5. How changes reach the browser

```
provider signal (push) ──► sync step: changesSince(cursor) ──► write mail_threads / members / mailboxes
                                   │ reset ⇒ mark every query unverified (rows kept; next read revalidates cheaply via version)
                                   ▼
                     mailThreadsServed.notify({ ids }) / thread value notify / mailboxes (SQL arm, change feed)
                                   ▼
                     open windows re-read (diffed by key) ──► DataView updates
```

- **One sync step per account.** A keyed mutex (`packages/keyed-mutex`) serialises it, and a
  coalescer (`packages/coalesce`) folds a burst of signals into one trailing run.
- For `messageAdded` in a thread that is not cached, the step fetches that thread's metadata.
  It needs it anyway to evaluate locally maintained queries, and a new thread usually lands
  at the head of the Inbox.
- **The change signal**, as the no-polling rule requires:
  - **Primary: Gmail push through a Pub/Sub *pull* (StreamingPull) subscription.** It is an
    outbound stream, so it needs no public endpoint and works on a laptop.
    - It runs as a `defineDaemon` on main, like `integrations/github-events`' forwarder.
    - A daily `defineJob` renews `users.watch`.
    - Setup needs a topic and subscription in the user's own Google Cloud project (they
      already bring their own OAuth client) and the `pubsub` scope. Both can be created
      through the API with the user's token, behind one "Enable instant updates" action.
  - **Documented fallback**, for when push is not set up, in a worktree (only main consumes
    the subscription), or when push goes quiet:
    - **While anyone is subscribed** (`whileSubscribed` on `mailThreads`), a
      `history.list` step every 30 s. That is 2 units, about 0.07% of the user budget.
    - **With nobody subscribed**, a scheduled `defineJob` every 10 min, to keep the cursor
      inside Gmail's history window and to drive prefetch.
    - Google itself recommends polling `history.list` for installed apps, and says push may
      drop notifications. The tick is the documented exception: there is no change signal
      without the Pub/Sub setup.
- **Mailboxes** are a SQL-arm `all` collection over `mail_mailboxes`, so the change feed
  carries them, counts included, refreshed by the sync step when `mailboxesChanged`.
- **Status** comes from `liveValue("mail.account-status")`. It holds connection (from
  `integrations/gmail`'s `useGmailAccess` blocker), push or fallback, the last sync, and
  offline. It also contributes a health-report row.

### 6. Writes: optimistic, durable, undoable

- **Actions** (archive/done, star, read/unread, label add/remove, trash, delete,
  move-to-inbox) are a `useOptimisticResource(mailThreads, …)` op, plus an endpoint per
  semantic op that takes thread ids. The server side:
  1. writes the predicted change into `mail_threads`, and into membership for locally
     maintained queries;
  2. enqueues a durable `mail.apply-op` job (`infra/jobs`, idempotent: it sets a target state
     rather than toggling);
  3. returns a watermark.
  - The job calls the provider, with retry and backoff as a bound around a network peer.
  - If it fails permanently, it restores the thread from the provider (`getThreads`) and
    raises a failed-op toast. This follows the never-revert overlay, and the provider's own
    state is the truth.
  - **Undo** is the inverse op, as a `liveAction` on `useToast()`.
  - Bulk selection uses the same ops with many ids (`batchModify`).
- **Offline.** The provider is unreachable, so ops stay queued as jobs and replay in order per
  thread (keyed). A cached window keeps answering. A window that is **not** covered fails
  with a typed `provider-unreachable` error ("Offline — this view isn't cached"), never an
  empty list.
- **Drafts.**
  - The local `mail_drafts` row is the working copy. The editor autosaves to it (an endpoint,
    debounced), so a keystroke is never lost to the network.
  - A coalesced job mirrors it to the provider (`saveDraft`, which is `drafts.update` on
    Gmail), keyed by draft and revision-checked.
  - The provider's drafts, from other devices, appear as threads with `hasDraft` and the
    `drafts` role, like any view. Opening one adopts it into a local row.
- **Compose / reply / forward.** This covers quoting, recipients, `In-Reply-To` and
  `References`, and attachments.
  - New attachments are uploaded through `infra/attachments`.
  - Forwarded attachments are referenced by `AttachmentRef` and fetched at send time.
- **Send with undo-send.** Send writes a `mail_outbox` row and a `mail.send` job with `runAt`
  set to now plus 10 s. Undo cancels the job and reopens the draft.
  - The job builds the MIME message, calls `provider.send` (`messages.send`, using the
    resumable upload above 5 MB) and deletes the provider draft.
  - The thread then arrives through the next change sync, and an optimistic "Sent" row covers
    the gap.
- **Quota.** All provider calls for an account go through one pacer: a token bucket of 6,000
  units per minute with two priorities (foreground reads and writes, then prefetch).
  - Gmail's 403/429 triggers exponential backoff (`packages/retry`), shared across callers.

### 7. Plugin layout

```
plugins/integrations/plugins/gmail/            (exists: token broker, scope, access affordances)
  plugins/api/        NEW  stateless typed Gmail REST client: threads/messages/history/labels/drafts/send/
                           attachments/watch/profile; HTTP batch (≤50); quota meter. Token as parameter.
  plugins/pubsub/     NEW  Pub/Sub topic+subscription setup and a StreamingPull listener (§5)
plugins/apps/plugins/mail/                     (app shell — sibling rebuild task)
  plugins/provider/   NEW  core: neutral model, MailProvider, MailQuery; web+server: MailProviders.Provider slot
  plugins/providers/plugins/gmail/  NEW  MailProvider over integrations/gmail/api: compileQuery (Filter→q),
                           label↔mailbox/role mapping, version = historyId, changesSince = history.list
  plugins/cache/      NEW  tables, coverage + fill, pacer, sync step, change signal + fallback, eviction,
                           mail.threads (external collection), mail.mailboxes, mail.thread, mail.account-status
  plugins/threads/    NEW  the threads DataView, fields, authored views (config/mail/threads.jsonc), row actions
  plugins/reader/     NEW  thread pane: InlineFrame rendering, cid/remote-image proxy, attachments, prefetch hints
  plugins/compose/    NEW  drafts, reply/forward, attachments, outbox + undo send
  plugins/labels/     NEW  label management (create/rename/delete/colour), label field options
```

- **Boundaries.**
  - `threads`, `reader` and `compose` import `cache/core` (the declarations) and
    `provider/core` (types) only.
  - Only `providers/gmail` imports `integrations/gmail`.
  - `cache` never names Gmail.

### 8. Existing primitives to reuse

| Need | Primitive |
|---|---|
| Google token, scopes, "fix connection" UI | `integrations/gmail` (`getGmailToken`, `useGmailAccess`, `GmailAccessAction`, `GmailAccessEmptyState`) over `auth` (central) |
| Windows, values, optimistic ops | `network/live` external arm + SQL arm, `useOptimisticResource`, `liveDataSource` |
| Filter tree, evaluation | `network/live/plugins/filter` (`Filter`, `matchesFilter`, `canonicalizeFilter`) |
| Views, saved views, switcher | `primitives/data-view` (`defineDataView`, `viewEdits`, `defineItemActions`, `DataViewSwitcher` for trash-like sources if wanted) |
| Durable work, schedules | `infra/jobs` (`defineJob`, `runAt`, `jobKey`), `defineDaemon`, `infra/retention` |
| Concurrency, pacing | `packages/keyed-mutex`, `coalesce`, `semaphore`, `retry`, `inflight` |
| Files | `infra/attachments` (`importAttachment`, `GET /api/attachments/:id`) |
| Untrusted HTML | `primitives/embed/plugins/frame` `InlineFrame`; `infra/html-decode`; `infra/safe-fetch` |
| Toasts + undo | `shell/notifications` `useToast` with `liveAction` |
| Health | `shell/health-report` row |

### 9. Primitive gaps

1. **A paced, batched Google HTTP client.** Today nothing does token-bucket quota pacing or
   multipart batching. Places only counts SKUs. This is built in `integrations/gmail/api`,
   generic enough to lift to `integrations/google` later.
2. **MIME.** There is no RFC 5322/2045 builder for send, and nothing walks a `full` payload
   (charsets, quoted-printable, `cid:`). It needs a small `packages/mime` plugin (or a vetted
   dependency such as `postal-mime` / `mimetext`).
3. **Pub/Sub StreamingPull from Bun.** It needs gRPC. Whether `@google-cloud/pubsub` (and
   `@grpc/grpc-js`) runs under Bun must be checked first.
   - If it does not, use the REST `subscriptions.pull` in a loop. That is a held request, not
     a timer.
4. **A typed refusal on a collection window.** `unresolved(reason)` exists for values only.
   A window that cannot be answered ("Gmail not connected" / "offline, not cached") needs a
   typed error the DataView can render with an action, instead of a generic error.
   - The likely shape is a loader error class that carries a kind, read through the window's
     `error` arm.
   - This needs the live owners' input; it is part of task 3.
5. **Attachment ids.** `importAttachment` wants a UUID. We use a UUIDv5 of
   (account, message, attachment id), which is deterministic and keeps the import idempotent.
   The 20 MB default upload cap must be raised to 25 MB for mail, or made per caller.
6. **Remote-image proxy.** There is no generic "fetch a public image for an iframe" route yet.
   It is small, built on `safe-fetch`, and could be generic (`infra/image-proxy`).

## Implementation breakdown (linear, each shippable)

1. **Gmail API client** (`integrations/gmail/plugins/api`). Typed calls, HTTP batch, quota
   pacer with priorities, and backoff. Tests replay recorded fixtures.
   *Ships:* a library with tests, and a `./equin run` probe script.
2. **Provider contract + Gmail provider** (`mail/plugins/provider`,
   `mail/plugins/providers/plugins/gmail`). Covers the neutral model, `compileQuery`
   (Filter → `q`, a total function over the declared operators, table-tested) and the
   label/role mapping. *Ships:* the contract and adapter with tests.
3. **Cache + on-demand windows** (`mail/plugins/cache`, `mail/plugins/threads`). Covers the
   tables, coverage and fill, `mail.threads`, `mail.mailboxes`, the authored sidebar views,
   search via the `query` column, boot preload, the typed window refusal, and eviction.
   *Ships:* a real, read-only, searchable Inbox and arbitrary views. It refreshes only on
   read until task 4.
4. **Change sync.** `changesSince` apply, locally maintained membership, reset handling,
   `notify`, the documented fallback tick plus the background job, `mail.account-status` and
   the health row. *Ships:* views that stay live.
5. **Reader.** `mail.thread` fetch on open, the body cache, prefetch, `InlineFrame`
   rendering, `cid:` and the remote-image proxy, and attachment open/download.
   *Ships:* reading mail.
6. **Actions.** Archive/done, star, read/unread, labels (apply, create, rename, delete),
   trash/delete and move to inbox. Optimistic, durable ops with undo toasts and bulk
   selection. *Ships:* triage.
7. **Compose.** Local drafts mirrored to Gmail drafts, compose/reply/reply-all/forward,
   attachments, `packages/mime`, and the outbox with undo send. *Ships:* sending.
8. **Push.** Pub/Sub setup action, the StreamingPull daemon and the daily `watch` renewal.
   The fallback tick stays for worktrees and silence. *Ships:* instant updates.

Tasks 1, 2 and 3 are the critical path. Tasks 5, 6 and 7 can run in parallel after 4. Task 8
is independent after 4.

## Verification (per task, overall)

- **Unit tests.** `compileQuery` tables, the coverage fill against a fake provider (cut
  mapping, newer-than-cut threads dropped, exhaustion, version skip), membership
  re-evaluation, reset, and the pacer.
- **A fake provider** (`provider/server/testing`) implementing `MailProvider` in memory. It
  drives every cache test and every e2e test without Gmail.
- **e2e on the worktree build.**
  - Cold open Inbox: skeleton, then rows.
  - Reopen: rows in the first frame.
  - A new filter view: loading, then rows, never an empty flash.
  - Search across mail older than any cached page.
  - Archive, then undo. Send, then undo send.
- **The real account.** Measure the quota spent per cold open, per reopen and per search, and
  the time to first row. Targets: reopen under 100 ms from cache, cold open under 1.5 s.

## Open questions for the user

1. **Push setup.** May the app create a Pub/Sub topic and subscription in your Google Cloud
   project and ask for the `pubsub` scope? *Recommendation:* yes, as task 8. Until then, the
   documented 30 s `history.list` tick runs while Mail is open.
2. **Thread rows only?** *Recommendation:* yes for v1 (conversation view). Message rows come
   later through the same machinery.
3. **Sort and group limits.** Views sort by date only, and sections are exact only for date
   groupings. The alternative is a full mirror, which this task rules out.
   *Recommendation:* accept this.
4. **Undo-send delay.** *Recommendation:* 10 s, configurable.
5. **Remote images.** *Recommendation:* load them by default through the server proxy (as
   Gmail does: no IP leak, but tracking pixels still fire). Per-sender blocking comes later.
6. **Cache budgets.** *Recommendation:* 500 MB of bodies, about 50k thread summaries,
   prefetch of the top 25. These go in Settings → Config.
