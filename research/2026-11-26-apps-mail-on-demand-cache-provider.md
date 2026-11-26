# Mail (rebuild): on-demand loading with a cache, behind a generic provider

**Status:** design; tasks 1 (Gmail client), 2 (contract + Gmail provider) and 3a (the cache,
server half) implemented. §1–2 below are as shipped; the corrections later tasks made to
later sections are marked *Task 2 correction* / *Task 3a correction*. The live measurements
are in *Measured on the real account (task 3a)* below.
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

`apps/mail/plugins/provider/core` (as shipped; its `CLAUDE.md` is the reference):

```ts
type MailboxRole = "inbox" | "sent" | "drafts" | "trash" | "spam" | "archive" | "important" | "all";
type Mailbox = { id: MailboxId; name: string; role: MailboxRole | null; kind: "system" | "user";
                 parentId: MailboxId | null; counts: { threads: number; unread: number } | null;
                 color: { text: string; background: string } | null };

type ThreadSummary = {                       // one list row
  id: ThreadId; version: ThreadVersion;      // Gmail: thread historyId; JMAP: state; IMAP: max modseq
  subject: string; snippet: string;
  participants: Participant[];               // senders, ≤ 10
  lastMessageAt: Date; messageCount: number;
  mailboxes: MailboxId[];                    // union over the messages
  unread: boolean; starred: boolean; hasAttachments: boolean; hasDraft: boolean;
  messages: MessageFacts[];                  // per message: id, date, mailboxes, unread, starred, isDraft
};
type ThreadContent = { id; version; messages: MessageContent[] };   // headers, text/html, attachment metas
type OutgoingMessage = { mime: Uint8Array; threadId: ThreadId | null; rfc822MessageId: string };
```

- **A role mailbox's id is its role** (`role:inbox`) on every provider, so the authored
  views (`{ "mailboxes": { "hasAny": ["role:inbox"] } }`) mean the same mailbox whichever
  provider serves them. Every other mailbox keeps the provider's own id. A provider lists
  only the roles it has: Gmail has no `archive` and no `all`, so neither is listed, and a
  query naming one is refused.
- **Gmail labels map to `mailboxes`.** `UNREAD` and `STARRED` are flags (JMAP keywords),
  never mailboxes. DRAFT is `role:drafts` (and `hasDraft`).
- **IMAP folders are mailboxes too.** A message is in exactly one, and the provider says so
  (`capabilities.mailboxModel: "folders"`).
- **Outgoing mail is RFC 5322 bytes**, built by the app (task 7's MIME builder). Every
  provider takes the same bytes: Gmail uploads them, IMAP APPENDs them, JMAP imports a blob,
  Outlook sends MIME. The bytes must carry `rfc822MessageId`. It is what reconciles a send
  whose outcome is unknown.
- **Rows are threads in v1** (Gmail's conversation view). A message-row view is a later
  addition, not a redesign: `MessageSummary` would come through the same coverage machinery
  under a second collection.

### 2. The provider interface

`provider/core` holds the contract. `provider/server` registers implementations
(`MailProviders.Provider`). As shipped:

```ts
interface MailProviderDefinition {                       // registered once per provider kind
  id: string; label: string;                             // "gmail"
  capabilities: { mailboxModel: "labels" | "folders";
                  mailboxDefinitions: "in-changes" | "relist";   // Gmail/IMAP changes carry no label create/rename
                  push: "pubsub" | "eventsource" | "idle" | "none" };
  compileQuery(q: MailQuery, ctx: { mailboxes: readonly Mailbox[] }): CompiledMailQuery;  // pure
  open(accountId: string): MailProvider;                 // the account's ONE provider in this process
}
type CompiledMailQuery = { kind: "query"; providerQuery } | { kind: "nothing" }   // or: [] — no call
                       | { kind: "refused"; refusal: { column; op; reason; message } };

interface MailProvider {
  // — reads —
  listMessages(q: ProviderQuery, page: { olderThan: Date | null; limit: number; cursor: ListCursor | null })
    : Promise<{ hits: { thread: ThreadId; message: MessageId }[]; next: ListCursor | null }>;  // task 3a
  getThreads(ids): Promise<({ id; kind: "found"; summary } | { id; kind: "gone" } | { id; kind: "failed"; error })[]>;
  getThreadContent(id): Promise<{ kind: "found"; content } | { kind: "gone" }>;
  getAttachment(ref: AttachmentRef): Promise<Uint8Array>;
  listMailboxes(): Promise<Mailbox[]>;
  findMessage(rfc822MessageId): Promise<{ kind: "found"; messageId; threadId } | { kind: "absent" }>;
  // — changes —
  currentCursor(): Promise<ChangeCursor>;
  changesSince(c): Promise<
    | { kind: "changes"; threads: ThreadId[]; mailboxes: "changed" | "unchanged"; next: ChangeCursor; more: boolean }
    | { kind: "reset" }>;                                // 404 / cannotCalculateChanges / UIDVALIDITY
  // — writes: semantic, idempotent (each sets a target state) —
  archive / moveToInbox / trash / untrash / deleteForever(ids);
  setFlags(ids, { unread?, starred? }); setMailboxes(ids, { add, remove });
  createMailbox({ name, parentId }) / renameMailbox(id, name) / deleteMailbox(id);
  saveDraft(m: OutgoingMessage, existing: DraftId | null): Promise<{ draftId; messageId; threadId }>;
  deleteDraft(id); send(m: OutgoingMessage): Promise<{ messageId; threadId }>;
}   // every method takes { priority?: "foreground" | "background"; signal? } last
```

- **`changesSince` has no `removed` list.** No provider can say a thread is gone from a
  history record alone (a deleted message may leave others). The caller re-reads `threads`,
  and `getThreads` answers `gone` for those that are.
- ***Task 3a correction:* the list answers messages, not threads.** `listThreads` (refs with
  a version) became `listMessages`: the messages matching the query, newest first by the
  provider's clock, each naming its thread. Measured: Gmail's `threads.list` orders a thread
  by its FIRST message (thread id order), so no date cut can page it; `messages.list` orders
  by message date. A thread's place is its latest MATCHING message — also what JMAP
  `collapseThreads` and IMAP `SEARCH` give. The version skip moved from the list (Gmail's
  `messages.list` carries no `historyId`) to the cache: a listed thread's cached summary is
  re-read only when stale or missing the listed message.
- ***Task 3a additions:*** `capabilities.listOrderSlackMs` (how far the provider's list order
  and cut may stray from `MessageFacts.date`: Gmail 60 s, measured −9 s…+12 s);
  `definition.connectedAccount()` (the account and its address, no mail call — the cache
  never names Gmail); `ThreadSummary.recipients` (`To`, for the `to` column).
- **`more`** follows JMAP's `hasMoreChanges`. Gmail reads at most 10 history pages
  (5,000 records) per call and resumes after the last record it read.
- **Errors are the contract's.** `MailUnreachableError` (offline: a cached window still
  answers, an uncovered one fails typed), `MailNotConnectedError` (needs reconsent: the UI
  shows `GmailAccessAction`), and `MailOutcomeUnknownError`. The last is a send, draft
  create or label create that may have happened: the Gmail provider has already searched
  `rfc822msgid:` (or the label name) and not found it. Never resend on it alone; ask
  `findMessage` again first.
- **`MailQuery`** is the live filter language's `Filter` tree, from
  `network/live/plugins/filter`, over `MAIL_QUERY_COLUMNS`:
  - `mailboxes` (stringArray), with `hasAny` / `hasAll` / `hasNone`;
  - `unread` / `starred` / `hasAttachment`, with `eq` / `ne`;
  - `date`, with `lt` / `lte` / `gt` / `gte`, at whole seconds;
  - `from` / `to` / `subject`, with `contains` / `notContains`;
  - `query`, with `contains`: the search box, in provider syntax.

  The operator table `MAIL_QUERY_OPS` is the contract. Every provider compiles every
  pair, and its compile test walks the table.
  - Gmail builds a `q` string (task 2, table-tested);
  - JMAP builds an `Email/query` FilterCondition;
  - IMAP builds a `SEARCH` key list.
- ***Task 2 correction:* the query is evaluated per message.** A thread matches when ONE of
  its messages matches the WHOLE filter. That is what Gmail search, JMAP `Email/query` with
  `collapseThreads`, IMAP `SEARCH` and Outlook's message `$filter` all compute, so it is the
  only semantics every provider can answer exactly. `and(unread, from ana)` needs one unread
  message from Ana. `mailboxes hasNone [inbox]` is a thread with a message outside the
  inbox. Re-evaluating a filter over the thread unions (`ThreadSummary.unread`, `.mailboxes`)
  gives a *different* answer. Hence `ThreadSummary.messages` (per-message facts), and the
  change to §4's locally maintained class below.
- **A clause the provider cannot express is refused.** It surfaces as the DataView's
  `UnavailableFilterRuleError` for that rule, and is never post-filtered locally over
  partial data. The reasons are typed: `unsupported-op`, `unknown-mailbox`,
  `unsupported-mailbox` (Gmail's `role:archive`), and `unrepresentable-operand` (a `"` in
  a label or name, a date between seconds, an unbalanced search).
- **The filter UI offers only what can be compiled.** Each field declares only
  `MAIL_QUERY_OPS`, so an unsupported rule normally has no spelling at all (rung 1). The
  refusal is the guard for saved views and stale mailbox ids.
- **Writes are semantic.** "Archive" removes `INBOX` on Gmail and moves the thread to the
  Archive mailbox on IMAP. The UI calls `archive`, never the label math.
- **Registration.** Providers are an open set: a `MailProviders.Provider` server
  contribution, with the account row naming its `providerId`
  (`mailProviderById(id)`). The cache and the UI use only the interface
  (collection–consumer separation). v1 registers one provider.
- **One pacer per account per process**, for every caller that goes through the contract:
  `open(accountId)` memoizes, so they share one client and one pacer. The Gmail client and
  pacer stay exported for the probe script, so code outside the contract could still build a
  second pacer.

**How the other providers map, without a contract change:**

| | IMAP (CONDSTORE/QRESYNC) | JMAP (RFC 8620/8621) | Outlook (Graph) |
|---|---|---|---|
| mailboxes | folders (`mailboxModel: "folders"`), SPECIAL-USE → roles | `Mailbox` + `role` | `mailFolders` + well-known names |
| version / cursor | max MODSEQ of the thread / `HIGHESTMODSEQ` per folder (cursor = encoded per-folder map), changed UIDVALIDITY → `reset` | `Email` state / `Email/changes`, `cannotCalculateChanges` → `reset`, `hasMoreChanges` → `more` | `@odata.deltaLink` per folder, a 410 → `reset` |
| compileQuery | `SEARCH` keys per message (`SEEN`, `FLAGGED`, `SINCE`/`BEFORE` are dates only → `date` refused below a day, or post-cut) and a folder per mailbox clause (`hasAll` of two folders → `nothing`) | `FilterCondition` (`inMailbox`, `hasKeyword`, `after`/`before`, `from`, `text`) + `collapseThreads` | `$filter` / `$search` on messages, grouped by `conversationId` |
| listThreads cut | `SEARCH … BEFORE` + local key drop, as Gmail | `Email/query` sorted `receivedAt` + `anchor` | `receivedDateTime lt` |
| threads | `THREAD=REFERENCES` or References/In-Reply-To grouping | `Thread/get` | `conversationId` |
| archive | MOVE to the `\Archive` folder | `Email/set` mailboxIds | `move` to `archive` |
| send | SMTP submit + APPEND to Sent; `findMessage` = `SEARCH HEADER Message-ID` | `EmailSubmission/set`; `Email/query` header filter | `sendMail` (MIME); `internetMessageId eq` |
| push | IDLE (`push: "idle"`) | EventSource (`"eventsource"`) | change notifications (webhook) or delta polling |

IMAP's one wrinkle is a cursor over several folders. `ChangeCursor` is opaque, so it can
encode one `HIGHESTMODSEQ` per selected folder. `date` at second precision is refused (or
widened, then cut by key) where `SEARCH` only knows days. Both stay inside the contract.

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
- **What a cold page costs** (Google's published prices; task 1 has not yet confirmed them
  live):
  - A cold 50-thread metadata page is `threads.list` (10) plus 50 × `threads.get` metadata
    (40), which is **2,010 units**, a third of the per-minute budget. Three cold views in a
    minute use it all up.
  - Revalidating a covered page whose threads did not move costs 10.
  - So the `historyId` version skip in `fill` is not an optimisation. It is what keeps the
    app inside quota.
  - `threads.get` is never called for a thread whose `version` is cached.
- **Bodies** are prefetched by a low-priority job, through the pacer's background half
  (3,000 units a minute). A `full` thread costs 120, so that is **25 bodies a minute** at
  most. The list below is in priority order, and a minute's prefetch covers only its head:
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
  - ***Task 3a correction:*** the sort key is (`date` desc, `id`) where a row's `date` is the
    thread's latest message MATCHING the window's filter (stored per query as
    `mail_query_members.at`), not `lastMessageAt`: no provider can page threads by their
    latest message overall under a per-message filter (a thread whose only unread message is
    old would be found arbitrarily deep). Read by id, the row's `date` is `lastMessageAt`.
  - A fill lists messages from `floor_at + listOrderSlackMs` (`before:` that second, rounded
    up) with `pageToken` *within one fill*, places each hit by its message's date from the
    summary, and moves the floor to the last placed date plus the slack. Hits newer than the
    cut are members already. Coverage claims only what the slack makes safe.
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
- ***Task 3a correction:* `date` is provider-evaluated.** Gmail's `after:` / `before:` compare
  its own receipt clock, measured −9 s to +12 s from `internalDate` (12 messages; on this
  account `internalDate` equals the `Date` header, ms always 0). So `date` is not among the
  locally maintained columns (below): those are `mailboxes`, `unread`, `starred`.
- ***Task 2 correction:* the date column.** The query's date column is `date`, a message's
  received time, and the row's is `lastMessageAt`. Task 3's DataView date filter must
  lower to `date`, not filter `lastMessageAt`. For `gte` / `gt` the two agree; for `lt` /
  `lte` they differ (any message before X vs the last message before X).
- **Search.** The search box is the `query` column. `searchable: ["query"]` lowers it to a
  `contains(query, text)` clause, which Gmail compiles to raw `q` text. So the full Gmail
  operator language works (`from:ana has:attachment older_than:1y`), over the **whole mailbox,
  server-side**.
  - There is no local full-text index. It could only find cached mail, which is exactly the
    misleading-partial answer we are avoiding.
  - Each search is a query row with a 1-day LRU.
- **Freshness of a covered query.** There are two classes, set when the query is compiled:
  - **Locally maintained.** The filter uses only columns the cache holds exactly *per
    message*: `mailboxes`, `unread`, `starred` (*task 3a:* not `date`, see above). These are every sidebar view, and
    most user-built ones.
    - *Task 2 correction:* `hasAttachment` is NOT among them. The summary's
      `hasAttachments` is a header hint, and Gmail's `has:attachment` is its own test.
    - The sync engine (§5) re-evaluates membership itself on each changed thread: the
      thread is in when **some entry of `ThreadSummary.messages` matches the whole filter**
      (`matchesFilter` per message, the query being per message, §2). It is never
      evaluated over the thread-level unions. It inserts the thread above the floor, or
      removes it.
    - These queries stay fresh with **zero** provider calls, so reopening the Inbox is pure
      SQL.
  - **Provider-evaluated.** Free text, `from:`/`subject:` contains, and other provider
    semantics.
    - A change since `verified_cursor` marks the head stale. The next read answers from the
      cache *immediately*, re-lists the head in the background, diffs it, and calls
      `notify()` if anything moved.
    - Stale-while-revalidate is allowed here because the rows shown are real rows of the
      query as of a known cursor, never manufactured ones.
- **Instant open.** *Task 3a: not declared.* A collection's boot tuple is its param-less
  default window — unfiltered (every message), not the Inbox — and the boot snapshot loads it
  for EVERY app's first paint (blocking, `ifUnavailable: "block"`); an uncovered tuple would
  wait on a Gmail fill, a disconnected account would refuse at boot. Preloading the Inbox
  needs a live-API change: a declared preload tuple (a `where`), scoped to the Mail app's
  composition, answered from the cache only. Without it, a reopen is the cache's SQL plus
  one socket round trip (measured below).
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
- **Quota.** All provider calls for an account go through one pacer
  (`integrations/gmail/api`'s `createQuotaPacer`, built in task 1). It keeps a **sliding 60 s
  window** of 6,000 units, which is exactly Gmail's "per user per minute". A token bucket
  would let a full bucket plus a minute's refill through in one minute. It has two FIFO
  priorities: foreground reads and writes, then background.
  - Background (prefetch, revalidation) is admitted only while no foreground call waits, and
    only into half the window.
  - Gmail's 403 (`rateLimitExceeded` / `userRateLimitExceeded`) or 429 **pauses the pacer**
    for `Retry-After` or the backoff delay, so every caller backs off, not only the one that
    was refused.
  - 5xx and unreachable calls are retried with a private exponential backoff, at most 5
    attempts.
  - **One pacer per account per process.** Two processes over one account (main and a
    worktree build) each spend the full budget. The 429 pause is what catches that.

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

1. **A paced, batched Google HTTP client.** Today nothing does quota pacing or multipart
   batching. Places only counts SKUs. This is built in `integrations/gmail/api` (task 1,
   done): a sliding-window pacer, the batch codec and a bounded backoff. The pacer and the
   codec are pure `core`, generic enough to lift to `integrations/google` later.
2. **MIME.** There is no RFC 5322/2045 builder for send, and nothing walks a `full` payload
   (charsets, quoted-printable, `cid:`). It needs a small `packages/mime` plugin (or a vetted
   dependency such as `postal-mime` / `mimetext`).
3. **Pub/Sub StreamingPull from Bun.** It needs gRPC. Whether `@google-cloud/pubsub` (and
   `@grpc/grpc-js`) runs under Bun must be checked first.
   - If it does not, use the REST `subscriptions.pull` in a loop. That is a held request, not
     a timer.
4. **A typed refusal on a collection window.** *Done in task 3a:* `liveCollection(key, {
   refusals: [...] })` (window, lookup and `all` forms), thrown as `c.refuse(code, message)`
   from an external source, read as the error arm's `kind: "refused"` with a typed `code` (no
   Retry, never reported) — the same mechanism as `liveValue`'s refusals. DataView's
   `errorState` may be a function of the failure, so the Mail list renders
   `GmailAccessAction` for `not-connected`. `mail.threads` declares `not-connected`,
   `offline-not-cached` and `filter-refused`.
5. **Attachment ids.** `importAttachment` wants a UUID. We use a UUIDv5 of
   (account, message, attachment id), which is deterministic and keeps the import idempotent.
   The 20 MB default upload cap must be raised to 25 MB for mail, or made per caller.
6. **Remote-image proxy.** There is no generic "fetch a public image for an iframe" route yet.
   It is small, built on `safe-fetch`, and could be generic (`infra/image-proxy`).

## Implementation breakdown (linear, each shippable)

1. **Gmail API client** (`integrations/gmail/plugins/api`). Typed calls, HTTP batch, quota
   pacer with priorities, and backoff. Tests replay recorded fixtures.
   *Ships:* a library with tests, and a `./equin run` probe script.
   *Done*, except the live probe run. The connected account had no Gmail scope yet, so the
   latency and quota of a real 50-thread page were not measured. The probe
   (`integrations/gmail/plugins/api/scripts/probe.ts`) prints them once access is granted.
   Task 3 should run it first.
2. **Provider contract + Gmail provider** (`mail/plugins/provider`,
   `mail/plugins/providers/plugins/gmail`). Covers the neutral model, `compileQuery`
   (Filter → `q`, a total function over the declared operators, table-tested) and the
   label/role mapping. *Ships:* the contract and adapter with tests.
   *Done.* As shipped in §1–2, with the per-message query semantics, `ThreadSummary.messages`,
   and the fake provider (`provider/server/testing`: `createFakeMailProvider`).
   - The client gained a 401 retry with a refreshed token: `accessToken({ refused })` →
     `getGmailToken({ refused })` → auth central refreshes the token it still holds. It
     also gained single-message `modify` / `trash` / `untrash` / `delete`.
   - **Checked by the live probe in task 3a** (`scripts/q-probe.ts`):
     - `after:` is inclusive and `before:` exclusive, but on Gmail's own clock, which strays
       from `internalDate` (−9 s…+12 s): true only within that slack;
     - `label:"Parent/Child name"` holds for every label measured except a name with
       parentheses (0 matches). The hyphen form `label:Parent-Child-name-(x)` (spaces and
       `/` as `-`, unquoted) matched every label (20/20). compileQuery quotes, and uses the
       hyphen form for a parenthesised name (refusing unmeasured characters and two labels
       with one spelling there). `label:Parent` never matches its sub-labels' messages;
     - parentheses group as assumed: `(a OR b)` is the union, `-(a OR b)` the complement,
       `(a) b` = `a b`.
   - Bulk writes cost 10 units a thread (`threads.modify`). Task 6 should do bulk triage with
     `messages.batchModify` over `ThreadSummary.messages` ids, about 50 units per 1,000
     messages.
   - **Main and a worktree** each have their own pacer over one Gmail budget. Only Google's
     429 (which pauses a pacer) catches them overspending together. Unchanged.
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

## Measured on the real account (task 3a, 2026-11-26)

46,134 threads / 61,342 messages, 43 labels (28 user). `./equin run` scripts run at macOS
background priority (darwinbg), so wall times are upper bounds.

| Step (step 1's probe) | ms | units |
|---|---|---|
| `labels.list` / `labels.get` ×15 (batch) | 89 / 201 | 1 / 15 |
| `threads.list` INBOX max 50 | 202 | 10 |
| `threads.get` metadata ×50 (batch) | **1,898** | **2,760** (not 2,000) |
| `history.list` | 75 | 2 |
| `threads.get` full ×1 / an attachment | 90 / 927 | 120 / 20 |

- **The metadata batch costs more than the price list.** 2,760 units for 50 threads means
  about 19 parts were refused for rate inside the batch and re-sent (each re-send is charged
  again). Google rate-limits concurrent batch parts per user; a smaller batch (10–20) or a
  few in flight may be both faster and cheaper. A cold 50-row Inbox page is therefore ~2 s and
  ~2,800 units today, over the 1.5 s target — the first lever is the batch shape (a follow-up
  on the Gmail client), not the cache.
- **Cache windows**, measured through the served collection (the resource HTTP read of
  `mail.threads` on the worktree build, 50-row windows):

  | Window | cold | warm (covered) |
  |---|---|---|
  | Inbox, page 1 | 2.18 s | 6–8 ms |
  | Inbox, page 2 (key-range cut) | 0.39 s | 12 ms |
  | Sent, page 1 / page 2 | 1.76 s / 1.50 s | 7 ms / 6 ms |
  | Search `invoice` | 4.99 s | 12 ms |
  | Search `has:attachment older_than:2y`, right after two cold Inbox pages | 48.7 s | 10 ms |
  | `mail.mailboxes` (41, all with counts) | — | 4–5 ms |

  - A cold page fetches about 53 summaries for 50 rows (the rows plus the slack's margin):
    ~2,100 units before batch re-sends. Three cold views inside one minute exceed the
    6,000-unit budget, and the pacer waits (the 48.7 s row: its 75 summaries took 3.3 s
    once admitted). The design's "three cold views a minute" limit is real, and the batch
    re-sends above make it worse.
  - A covered window is Postgres alone (no provider call; a background `history.list`
    follows it). Pages tile with no gap or overlap; a refused filter answers `422 refused`
    with its code.

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
