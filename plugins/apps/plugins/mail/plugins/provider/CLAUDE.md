# mail/provider

The **provider-neutral mail contract**, JMAP-shaped. The cache and the UI use
only this; each provider (`mail/providers/*`) implements it. Design: §1–2 of
[`research/2026-11-26-apps-mail-on-demand-cache-provider.md`](../../../../../../research/2026-11-26-apps-mail-on-demand-cache-provider.md).

## The model (`core`)

- **Ids** are branded strings only their provider reads (`ThreadId`,
  `MessageId`, `DraftId`, `ChangeCursor`, `ThreadVersion`, `ListCursor`,
  `ProviderQuery`).
- **Mailboxes.** A role mailbox's id is the role (`role:inbox`, via
  `roleMailboxId`) on every provider, so an authored view means the same
  mailbox wherever it runs. Any other mailbox is the provider's own id
  (`nativeMailboxId`, which may not start with `role:`). Roles are JMAP's;
  a provider lists only the ones it has (Gmail has no `archive` or `all`).
- **Flags are not mailboxes.** `unread` / `starred` are booleans (JMAP's
  `$seen` / `$flagged`), so Gmail's UNREAD and STARRED labels never appear as
  mailboxes.
- **`ThreadSummary`** is one list row (senders in `participants`, `To` in
  `recipients`). Its facts are unions / "any" over the
  thread's messages. `version` moves on any change, so a cached summary with
  the same version is current (the fetch is skipped). `hasAttachments` means a
  file the reader lists (an attachment not `inline`: a `cid:` image in the
  body is none), exact where the provider holds the parts (local, the fake),
  a header hint where its list read has no MIME tree (Gmail); the content is
  exact. `messages` holds each message's
  own facts (`MessageFacts`: date, mailboxes, unread, starred, draft), so a
  query can be re-checked per message over a cached thread.
- **`ThreadContent`** holds the messages, oldest first: headers parsed,
  `text` / `html` decoded (`unknownCharset` names a charset no decoder knew),
  and attachments with an `AttachmentRef` to fetch their bytes.
- **`OutgoingMessage`** is RFC 5322 bytes plus the `Message-ID` they carry.
  Every provider takes the same bytes: Gmail uploads them, IMAP APPENDs,
  JMAP imports a blob, Outlook sends MIME. The Message-ID is what reconciles
  a send whose outcome is unknown, so the bytes must carry it
  (`assertOutgoingMessageId`).

## The query (`MailQuery`)

A `Filter` tree (`network/live/plugins/filter`) over `MAIL_QUERY_COLUMNS`:

| Column | Ops (`MAIL_QUERY_OPS`) |
|---|---|
| `mailboxes` (stringArray of ids) | `hasAny` `hasAll` `hasNone` |
| `unread` `starred` `hasAttachment` | `eq` `ne` |
| `date` (received, whole seconds) | `lt` `lte` `gt` `gte` |
| `from` `to` `subject` | `contains` `notContains` |
| `query` (the search box, provider syntax) | `contains` |

- **The semantics are per message.** A thread is in the answer when ONE of its
  messages matches the WHOLE filter. That is what Gmail search, JMAP
  `Email/query` with `collapseThreads`, IMAP `SEARCH` and Outlook's message
  `$filter` all compute, so every provider can answer it exactly. Consequence:
  `and(unread, from ana)` needs one unread message from Ana; a thread-level
  re-evaluation over `ThreadSummary` (unions) is NOT the same query (see the
  design doc, §4, for what the cache may maintain locally).
- **Text columns are provider-evaluated.** Gmail matches words, not
  substrings. Never re-evaluate `from` / `to` / `subject` / `query` over
  cached rows.
- **`MAIL_QUERY_OPS` is the contract**, not one provider's reach
  (`core/internal/query.ts`; published from `core` and `server/testing`;
  `isDeclaredMailOp` is the public test). Every
  registered provider compiles every pair; its compile test walks the table.
  `mail.threads` declares it as its `filterOps`, so the live codec refuses any
  other pair on both sides of the wire and the threads list's Filter offers
  exactly these.
- **`compileQuery` answers** `query` (a `ProviderQuery`), `nothing` (`or: []`:
  empty without asking), or `refused` with the clause and a reason
  (`unsupported-op`, `unknown-mailbox`, `unsupported-mailbox`,
  `unrepresentable-operand`). A refusal is never a dropped rule.

## The provider (`MailProvider`, `MailProviderDefinition`)

- **Reads:**
  - `listMessages(query, { olderThan, limit, cursor })` lists the matching
    MESSAGES, newest first by the provider's clock, each naming its thread —
    so a thread's place is its latest matching message (Gmail's
    `threads.list` orders by a thread's first message, so no date cut pages
    it). `olderThan` cuts by the provider's clock; newer hits may come back
    (the caller drops them by key). No version per hit: the cache decides
    when a summary is current.
  - `getThreads(ids)` answers one `found` / `gone` / `failed` per id.
  - Also: `getThreadContent`, `getAttachment`, `listMailboxes` (with counts
    when known) and `findMessage(Message-ID)`.
- **Changes:**
  - `currentCursor()`.
  - `changesSince(cursor)` answers `changes` (`threads` to re-read,
    `mailboxes` changed or not, `next`, and `more` when another call is
    needed) or `reset` (Gmail 404, JMAP `cannotCalculateChanges`, IMAP
    UIDVALIDITY).
- **Writes are semantic and idempotent:** `archive`, `moveToInbox`, `trash`,
  `untrash`, `setFlags`, `setMailboxes`, mailbox
  create / rename / delete, `saveDraft`, `deleteDraft` (a draft already
  gone is no error), `send`. `findDraft(messageId)` finds the draft whose
  message a thread lists (`isDraft`) — what compose adopts a draft made
  elsewhere by. "Archive" is
  a label removal on Gmail and a move on IMAP. Each sets a target state, so a
  durable job may replay it. The message writes take **`MailWriteTarget`s**
  (a thread and the message ids the caller knows — its summary's), so a
  provider writes per message (Gmail: one `messages.batchModify` per 1,000);
  a message that arrived after the caller's summary is left as it is.
- **Errors:**
  - `MailUnreachableError`: offline. A cached answer stands.
  - `MailNotConnectedError`: the account needs (re)consent.
  - `MailOutcomeUnknownError`: a send or create may have happened and
    reconciling did not find it. Ask `findMessage` again before any resend.
    `findMessage` must find a message this account SENT by the Message-ID
    its bytes carried, even where the provider renames it (Gmail does: its
    provider adds `X-Equin-Message-Id` to what it sends and reads it back).
  - `MailRefusedError`: the write is refused as asked (a mailbox name
    taken, a move under itself, a colour off the palette) and nothing was
    written — the caller's 400.
- **Mailboxes as a tree:** `createMailbox`, `renameMailbox` (its own name),
  `moveMailbox` (a new parent, everything under it moving along),
  `setMailboxColor` (one of `capabilities.mailboxColors.palette`, or null
  where `clearable`), `deleteMailbox` (its sub-mailboxes move up to its
  parent).
- **`MailProviderDefinition`:** `id`, `label`, `capabilities`
  (`mailboxModel`, `mailboxDefinitions` (`relist` when changes carry no
  mailbox create / rename), `listOrderSlackMs` — how far the list
  order and cut may stray from `MessageFacts.date`: Gmail 60 s), `push`
  (a `MailPush` — `state()` not-set-up / starting / live / down, and
  `listen({ changed, state })` — or null: the cache's fallback tick is then
  the change signal; Gmail's is Pub/Sub, `providers/gmail`), the pure
  `compileQuery(query, { mailboxes })`, `open(accountId)`, and
  `connectedAccount()` (the account id and address, `not-connected`, or
  `unreachable` when the connection cannot be checked now — no mail call). `open` answers the account's ONE
  provider in the process, so there is one quota pacer per account.
- **Registration (`server`):** `MailProviders.Provider(definition)` in
  `contributions`. Several may be registered (a composition shipping the
  local demo mailbox beside Gmail): the cache serves one account (v1) and
  resolves its provider from Settings' choice or from which one is connected
  (`mail/cache`), never from how many are registered, and never names one;
  `mailProviderById(id)` finds one by id.
- **Its reads (`ServerMailProvider.reads`, required):** the Postgres tables
  its own I/O reads (the connection check, lists, a thread) and why its
  change signal covers them — `[]` for Gmail (its API), the `mail_local_*`
  tables for the local mailbox. The cache calls a provider inside its served
  loaders, so these land in the loaders' read sets: the cache's `reads` thunk
  (`mailCacheReads`) takes them from the registry as `notified` relations, so
  a provider can't be registered with its reads undeclared, and the cache
  never names one.

## Testing (`server/testing`)

`createFakeMailProvider({ mailboxes?, threads?, changesPageMax?,
listOrderSlackMs?, kind?, account?, push? })` is an in-memory label-model provider with the
contract's semantics: per-message queries (its provider query is the
canonical filter JSON), messages newest first, a per-message `before` cut, a
per-message `providerSkewMs` (the provider's clock off `date`, as Gmail's),
versions that move on change, a change log with `more`, and
`expireHistory()` for a reset. It returns:

- `definition` and `provider`;
- `calls`, to count what a fill cost;
- `deliver(thread, message)`, to add mail;
- `targets(ids)`, write targets naming every message of each thread (a
  change "made elsewhere" in a test);
- `failNext(method, error, { after })`. With `after: true` the write lands
  and its answer is lost;
- `setConnected(false | "unreachable")`, so `connectedAccount()` answers
  not-connected / unreachable.

The cache and e2e tests run on it, never on Gmail.

<!-- AUTOGENERATED:BEGIN — do not edit; regenerated by `./equin build` -->

## Plugin reference

- Description: Mail providers, web half: the MailProviderUi.Connect slot — each provider kind's connect surface, drawn in place of a mail list or thread its account cannot answer (not connected) — MailProviderConnect renders the registered ones (several: each, one under the other). Registers mail providers: MailProviders.Provider(definition) — a provider kind's id, capabilities, its pure compileQuery and open(accountId), which answers the account's one provider in this process, and the Postgres tables its own I/O reads (reads, required: the cache declares them as its loaders' reads) — and mailProviderById, the one lookup the cache uses by the id an account names.
- Web:
  - Slots: `MailProviderUi.Connect`
  - Slot contributors:
    - `MailProviderUi.Connect` ← `apps.mail.providers.gmail`
    - `MailProviderUi.Connect` ← `apps.mail.providers.local`
  - Uses:
    - `primitives/css/spacing.Stack`
    - `primitives/slot-render.renderIsolated`
  - Exports (types): `MailProviderConnectContribution`
  - Exports (values):
    - `MailProviderConnect`
    - `MailProviderUi`
- Core:
  - Uses:
    - `network/live/filter.canonicalizeFilter`
    - `network/live/filter.decodeFilter`
    - `network/live/filter.encodeFilter`
    - `network/live/filter.Filter`
    - `network/live/filter.Filterable`
    - `network/live/filter.FilterColumn`
    - `network/live/filter.FilterOpId`
    - `network/live/filter.liveBoolean`
    - `network/live/filter.liveInstant`
    - `network/live/filter.liveText`
  - Exports (types):
    - `AttachmentMeta`
    - `AttachmentRef`
    - `ChangeCursor`
    - `CompiledMailQuery`
    - `ConnectedMailAccount`
    - `DraftId`
    - `FoundDraft`
    - `FoundMessage`
    - `ListCursor`
    - `ListedMessage`
    - `Mailbox`
    - `MailboxColor`
    - `MailboxId`
    - `MailboxRole`
    - `MailCallOptions`
    - `MailChanges`
    - `MailFlags`
    - `MailProvider`
    - `MailProviderCapabilities`
    - `MailProviderDefinition`
    - `MailPush`
    - `MailPushState`
    - `MailQuery`
    - `MailQueryColumn`
    - `MailQueryRefusal`
    - `MailQueryRefusalReason`
    - `MailWriteTarget`
    - `MessageBody`
    - `MessageContent`
    - `MessageFacts`
    - `MessageId`
    - `MessageListPage`
    - `OutgoingMessage`
    - `Participant`
    - `SavedDraft`
    - `SendIdentity`
    - `SentMessage`
    - `SummaryMessage`
    - `ThreadContent`
    - `ThreadContentResult`
    - `ThreadId`
    - `ThreadSummary`
    - `ThreadSummaryResult`
    - `ThreadVersion`
  - Exports (values):
    - `assertOutgoingMessageId`
    - `changeCursor`
    - `compileCanonicalMailQuery`
    - `decodeCanonicalMailQuery`
    - `deriveThreadSummary`
    - `draftId`
    - `isDeclaredMailOp`
    - `listCursor`
    - `MAIL_QUERY_COLUMNS`
    - `MAIL_QUERY_OPS`
    - `MAILBOX_ROLES`
    - `mailboxRoleOf`
    - `MailNotConnectedError`
    - `MailOutcomeUnknownError`
    - `MailRefusedError`
    - `MailUnreachableError`
    - `messageId`
    - `mimeMessageId`
    - `nativeMailboxId`
    - `providerQuery`
    - `roleMailboxId`
    - `THREAD_PARTICIPANTS_MAX`
    - `threadId`
    - `threadVersion`
- Cross-plugin:
  - Imported by:
    - `apps/mail/cache`
    - `apps/mail/compose`
    - `apps/mail/fixtures`
    - `apps/mail/providers/gmail`
    - `apps/mail/providers/local`
    - `apps/mail/reader`
    - `apps/mail/threads`
- Server:
  - Exports (types):
    - `MailProviderReads`
    - `ServerMailProvider`
  - Exports (values):
    - `mailProviderById`
    - `MailProviders`
- Test helpers:
  - Server: `@plugins/apps/plugins/mail/plugins/provider/server/testing`
    - `createFakeMailProvider`
    - `fakeCompileQuery` — The fake's compile: the canonical filter JSON is its provider query.
    - `MAIL_QUERY_OPS` — The operators each column offers — the contract, not one provider's reach: every registered provider compiles every pair here (its compile test walks this table), so the filter UI offers exactly these and an unsupported rule has no spelling.
    - Types: `FakeAttachment`, `FakeCall`, `FakeMailProvider`, `FakeMailProviderOptions`, `FakeMessageInput`

<!-- AUTOGENERATED:END -->
