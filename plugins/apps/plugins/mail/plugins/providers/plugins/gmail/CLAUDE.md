# mail/providers/gmail

The Gmail `MailProvider`, over the typed client in
[`integrations/gmail/api`](../../../../../../../integrations/plugins/gmail/plugins/api/CLAUDE.md).
Registered as `MailProviders.Provider` (id `gmail`). Only this plugin imports
`integrations/gmail`.

## Mapping

- **Labels.**
  - Role labels become role mailboxes: INBOX → `role:inbox`, SENT, DRAFT →
    `role:drafts`, TRASH, SPAM, IMPORTANT.
  - UNREAD and STARRED are flags.
  - Categories, CHAT and user labels keep their Gmail id.
  - A nested user label (`Work/Clients`) is named `Clients`, under the label
    named `Work` when one exists.
  - Gmail has no archive or all-mail mailbox, so neither role is listed or
    searchable. Archive is `archive()`.
- **Version** is the thread's `historyId`. **The change cursor** is the
  mailbox `historyId`:
  - `changesSince` reads `history.list` (up to `HISTORY_PAGES_PER_CALL` × 500
    records, then `more`, resuming after the last record).
  - A 404 is `reset`.
  - Label definitions are not in history (`mailboxDefinitions: "relist"`).
- **Summary.**
  - `threads.get` metadata with From / To / Subject / Content-Type, batched.
  - The subject is the first message's, the snippet the last's.
  - The date is the last non-draft message's `internalDate`.
  - `hasAttachments` means some message is `multipart/mixed`.
  - RFC 2047 words are decoded.
- **Content.** `threads.get` full gives:
  - the body: every text/plain and every text/html part not marked
    `attachment`, in order, joined (Apple Mail splits a body around inline
    images), each decoded in its declared charset. A large part behind an
    attachment id is fetched;
  - attachments: every other part with bytes (a PDF, an inline `cid:` image,
    a `text/calendar` invite). A forwarded `message/rfc822` is one attachment,
    never walked into: its body is not the outer message's. The handle is
    Gmail's attachment id, or `inline-part:<id>` for a small part Gmail sent
    inline, which `getAttachment` re-reads from the message;
  - a message deleted while its body was fetched (a 404) is `gone`.

## `compileQuery` (`compile-query.ts`)

Total over `MAIL_QUERY_OPS`: each clause has an exact spelling, or the query
is refused naming it. Every list call passes `includeSpamTrash: true`, so `q`
alone decides membership.

| Clause | `q` |
|---|---|
| mailboxes hasAny / hasAll / hasNone | `(a OR b)` / `a b` / `-a -b`, where a role is `in:inbox` … `is:important`, a category `category:social`, a user label `label:"Work/Big clients"` (its full name built from the mailboxes given; a missing parent is refused), or for a name with parentheses `label:Work-Big-clients-(EU)` (spaces and `/` written `-`, unquoted; an unmeasured character, unbalanced parentheses or two labels with one spelling are refused). `label:Parent` never matches its sub-labels |
| unread / starred / hasAttachment | `is:unread` / `is:starred` / `has:attachment`, `-` negated |
| date gte / gt / lt / lte | `after:s` / `after:s+1` / `before:s` / `before:s+1` (whole seconds only; on Gmail's receipt clock, −9 s…+12 s from `internalDate`) |
| from / to / subject | `from:"text"`, `-from:"text"` (no `"` in the text) |
| query | the text, in parentheses (balanced, or refused) |
| and / or | side by side / `(x OR (y z))` |

The cut of one fill is `withCut(q, olderThan)`: `q before:<its second,
rounded up>` — a superset, never fewer.

**Measured on a live account** (2026-11-26,
`integrations/gmail/api/scripts/q-probe.ts`):

- `after:` / `before:` compare Gmail's receipt clock, −9 s…+12 s from
  `internalDate`: the definition declares `listOrderSlackMs: 60_000`;
- `threads.list` orders by a thread's first message, `messages.list` by
  message date: `listMessages` lists messages;
- the quoted `label:"Name With Spaces (x)/Child"` matches nothing (a quoted
  name without parentheses is exact); the hyphen form matched every label;
- parentheses group as assumed (`(a OR b)`, `-(a OR b)`, `(a) b`).

## Writes

- Per thread through `threads.modify` / `trash` / `untrash` / `delete`, 8 at
  a time. `moveToInbox` = untrash, then add INBOX and remove SPAM.
  - Every write settles before the call answers. One failure is thrown as
    itself; several make an `AggregateError` naming the threads.
  - Cost: 10 units a thread, so archiving 500 threads takes about 5,000 units,
    nearly a minute's budget. Bulk triage (task 6) should use
    `messages.batchModify` over the summary's message ids, about 50 units per
    1,000 messages.
  - Labels nest by name (`Parent/Child`), so renaming or moving a label
    renames every label under it too (one `labels.patch` each), and deleting
    one first moves its sub-labels up to its parent (Gmail would keep
    `Parent/Child` as a root of that name).
  - A label's colour is one of `GMAIL_LABEL_COLORS` (18 of Gmail's palette
    pairs; `labels.patch` refuses any other colour), and `color: null` clears
    it — measured on a real account 2026-11-26. `labels.create` and
    `labels.patch` answer without the label's `type` (it is always `user`;
    the api client's `LabelWriteAnswerSchema`).
- **Outcome unknown is reconciled, never retried:**
  - `send` → `findMessage`. **Gmail renames a message sent through the
    API**: its Message-ID becomes Gmail's own (`<CA…@mail.gmail.com>`), so
    `rfc822msgid:` never finds a sent message by the id its bytes carried
    (measured 2026-11-26 on the real account: 0 hits; every other header
    kept — `api/scripts/headers-probe.ts`). So `send` adds
    `X-Equin-Message-Id: <the bytes' Message-ID>` to what it uploads, and
    `findMessage` searches `rfc822msgid:` (a message received), then reads
    that header off the account's 25 latest Sent and Drafts messages of the
    last two days (`(in:sent OR in:drafts) newer_than:2d`, metadata: ~130
    units). Drafts are renamed too (probed the same day), so a draft
    upload carries the header as well. Found →
    the sent message; else `MailOutcomeUnknownError`. Measured with
    `scripts/find-message-probe.ts`: a reply compose sent was found (400 ms,
    130 units), a made-up id answered absent.
  - Draft create: `findMessage`, then the draft of the message found.
  - A draft deleted in Gmail web is made again on the next save (an update
    answering 404 creates).
  - A 4xx that is not about access, a missing object or rate
    (`asRefused`) is `MailRefusedError`: nothing was written — a send
    refused this way is known not sent.
  - `findDraft(messageId)`: `drafts.list` paged (100 a page, at most 50
    pages) for the draft whose message it is. `deleteDraft` of a draft
    already gone (404) is done.
  - Label create (or a 409 for an existing name): the label by its unique
    name.
  - A lookup that fails too (most often the same dropped connection) leaves
    `MailOutcomeUnknownError`, never `MailUnreachableError`, which a caller
    could read as "nothing happened" and resend.
- **Auth.** The token comes from `getGmailToken`. On a 401 (a whole request,
  or batch parts) the client asks once more with `{ refused }`, so central
  refreshes. A second 401, or a scope refusal, is `MailNotConnectedError`.
  Central itself being down (`AuthCentralOfflineError`) is thrown as is: it
  is this machine's service, not Gmail.
- **One client and pacer per account per process** (`definition.ts`
  memoizes `open`). Main and a worktree are two processes: each has its own
  pacer over the same Gmail budget, and only Google's 429 (which pauses the
  pacer) catches them overspending together.
- **A foreground reserve** (`accounts.ts`, `FOREGROUND_RESERVE_UNITS`): the
  pacer's background share is what a minute leaves after four cold views
  of one page each (`messages.list` + 27 `threads.get` metadata, ~4,340 of
  6,000 units). Background work (prefetch, re-lists, catch-ups) is paced into the
  rest, never refused. At the pacer's default half, a background charge's
  minute in the window left a second cold view waiting up to a minute: a cold
  Inbox read waited 56 s on 2026-11-26 while 18 prefetched bodies held 36% of
  the window.

## Push ("instant updates", `server/internal/push/`)

Gmail publishes "this mailbox changed" (address + historyId) to a Cloud
Pub/Sub topic once `users.watch` names it; the provider's `push`
(`MailPush`) tells the cache, which runs its sync step (`changesSince` says
what moved). Design §5, task 8.

- **Setup** (`POST /api/mail/gmail/push/enable { projectId }`, from the
  "Gmail instant updates" row of Settings → Accounts): every step is "make it
  so", so Enable is idempotent — the topic `equin-gmail`, Gmail's publisher
  (`gmail-api-push@system.gserviceaccount.com`, `roles/pubsub.publisher`) on
  it, this backend's pull subscription, then `users.watch`. The project must
  be the OAuth client's (Gmail refuses a topic elsewhere), with the Cloud
  Pub/Sub API on, and the Google connection must carry the pubsub scope
  (`integrations/google-pubsub`). The first refusal is answered typed
  (`needs-scope`, `needs-gmail`, `unreachable`, `api-disabled` with Google's
  activation link, `refused` with the step and Google's words — at the watch
  step usually Gmail's new publisher grant still propagating: Enable again in
  a minute). Re-enabling on another project deletes the old subscription.
  `/disable` drops the row first (a later failure leaves push off), stops the
  consumer and deletes this backend's subscription; the topic and the watch
  stay (the watch is one per user, another backend may use it; unrenewed it
  lapses within 7 days).
- **One lifecycle lock.** Boot start, enable, disable, the renewal and
  shutdown run under one mutex, and a consumer's callbacks count only while
  it is the current one, so overlapping clicks never leave a consumer no row
  describes.
- **Per backend.** One topic; one subscription per namespace
  (`equin-gmail-<namespace>`: main's kept, a worktree's expiring after a day
  unused). The setup row (`mail_gmail_push`) is left out of forks, so a
  worktree consumes push only once set up from it — otherwise it keeps the
  cache's 30 s fallback tick.
- **The consumer** (`consumer.ts`): held REST pulls back to back (Pub/Sub
  holds the request until a notification is published; an empty answer
  sooner than 5 s is refused, so it cannot turn into polling). Each pull is
  cut at 60 s and sent again — the bound around a connection that died
  without a reset, which would otherwise hold `live` with nothing arriving.
  Each batch is signalled, then acked. A failure is `down` (with Google's
  words) and a reconnect after 1 s doubling to 60 s; `live` again once a pull
  answers or is held to its bound.
- **The watch lapse** is judged on main only (it renews the one per-user
  watch; a worktree's row never sees those renewals): `live` past the lapse
  reads as `down`, and a wake-up at the lapse moves the state then.
- **Renewal.** `mail.gmail-watch-renew` (daily, main) calls `users.watch`
  again (a watch lapses after 7 days; Google advises daily). On boot a watch
  lapsing within two days is renewed at once.
- **`mail.gmail-push`** (live value): the setup (project, topic,
  subscription, watch lapse) and the consumer state; the Accounts row and
  its setup card read it. The cache's health row says push vs fallback.

<!-- AUTOGENERATED:BEGIN — do not edit; regenerated by `./equin build` -->

## Plugin reference

- Description: The Gmail provider's browser half: its connect surface for Mail (the shared Gmail access state and the control that fixes it, in place), and Gmail instant updates in Settings → Accounts (under Google): grant the Pub/Sub scope, turn on the Pub/Sub API in the OAuth client's project, then Enable — which creates the topic, Gmail's publisher grant, this backend's subscription and the watch — and, once on, whether it delivers and Turn off. Registers the Gmail mail provider: MailProvider over integrations/gmail/api, one client and quota pacer per account, Gmail's q compiled from the contract's filter — and its push: Gmail publishing mailbox changes to a Pub/Sub topic in the user's own Google Cloud project (POST /api/mail/gmail/push/enable: topic, Gmail's publisher grant, this backend's pull subscription, users.watch; /disable), held pulls on this backend's subscription signalling the cache's sync step, the daily mail.gmail-watch-renew job on main, and mail.gmail-push (setup and consumer state).
- Web:
  - Contributes:
    - `MailProviderUi.Connect` "gmail" → `GmailConnect`
    - `Auth.Integration` "Gmail instant updates"
  - Uses: 25 symbols — full list in [REFERENCE.md](./REFERENCE.md)
    - `network/live/live-state` ×5
    - `primitives/setup-steps` ×5
    - `integrations/google-pubsub` ×3
    - `infra/endpoints` ×2
    - `primitives/css/ui-kit` ×2
    - `apps/mail/provider.MailProviderUi`
    - `auth.Auth`
    - `fields/date/format.useDateFormatter`
    - `integrations/gmail.GmailAccessEmptyState`
    - `network/live.useLive`
    - `primitives/css/spacing.Stack`
    - `primitives/css/text.Text`
    - `primitives/loading.Loading`
- Server:
  - Contributes:
    - `mail.provider` "Gmail"
    - `resource.declare` "mail.gmail-push"
    - `fork-data-exclusion` "mail_gmail_push"
    - `change-feed-exclusion` "mail_gmail_push"
  - Uses:
    - `apps/mail/provider.MailProviders`
    - `database.db`
    - `database/admin.ExcludeFromFork`
    - `ids.externalIdColumn`
    - `infra/endpoints.HttpError`
    - `infra/endpoints.implement`
    - `infra/jobs.defineJob`
    - `integrations/gmail.getGmailToken`
    - `integrations/gmail/api.createGmailClient`
    - `integrations/gmail/api.GmailClient`
    - `integrations/google-pubsub.createPubSubClient`
    - `integrations/google-pubsub.getPubSubToken`
    - `integrations/google-pubsub.PubSubClient`
    - `integrations/google-pubsub.subscriptionName`
    - `integrations/google-pubsub.topicName`
    - `network/live.serveValue`
    - `network/live/change-feed.ExcludeFromChangeFeed`
  - DB schema: `plugins/apps/plugins/mail/plugins/providers/plugins/gmail/server/internal/tables.ts`
  - Exports (values): `_mailGmailPush`
  - Register: `defineJob('mail.gmail-watch-renew')`
  - Resources: `mail.gmail-push` (push, notified)
  - Routes:
    - `POST /api/mail/gmail/push/enable`
    - `POST /api/mail/gmail/push/disable`
- Core:
  - Uses:
    - `infra/endpoints.defineEndpoint`
    - `network/live.liveValue`
  - Exports (types):
    - `GmailPushSetupResult`
    - `GmailPushStatus`
  - Exports (values):
    - `disableGmailPush`
    - `enableGmailPush`
    - `GCP_PROJECT_ID`
    - `gmailPushStatus`
    - `GmailPushStatusSchema`
- Cross-plugin:
  - Uses tokens:
    - `ui/tokens/color-palette --destructive`
    - `ui/tokens/color-palette --muted-foreground`
- Exemptions:
  - Exempts itself from: `endpoints/no-raw-content-disposition` — `server/internal/content.ts` (sanctioned)

<!-- AUTOGENERATED:END -->
