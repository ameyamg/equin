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
  - `threads.get` metadata with From / Subject / Content-Type, batched.
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
| mailboxes hasAny / hasAll / hasNone | `(a OR b)` / `a b` / `-a -b`, where a role is `in:inbox` … `is:important`, a category `category:social`, a user label `label:"Work/Clients"` (its full name built from the mailboxes given; a missing parent is refused, never a shorter name) |
| unread / starred / hasAttachment | `is:unread` / `is:starred` / `has:attachment`, `-` negated |
| date gte / gt / lt / lte | `after:s` / `after:s+1` / `before:s` / `before:s+1` (whole seconds only) |
| from / to / subject | `from:"text"`, `-from:"text"` (no `"` in the text) |
| query | the text, in parentheses (balanced, or refused) |
| and / or | side by side / `(x OR (y z))` |

The cut of one fill is `withCut(q, olderThan)`: `q before:<second + 1>`.

**Unverified against a live account** (the probe has not run yet: no Gmail
scope granted). These assume Gmail's documented behaviour:

- `after:` is inclusive and `before:` exclusive;
- `label:"Name With Spaces/Child"` names a nested label;
- parentheses group terms at the top level.

The live probe should check all three before the cache relies on them.

## Writes

- Per thread through `threads.modify` / `trash` / `untrash` / `delete`, 8 at
  a time. `moveToInbox` = untrash, then add INBOX and remove SPAM.
  - Every write settles before the call answers. One failure is thrown as
    itself; several make an `AggregateError` naming the threads.
  - Cost: 10 units a thread, so archiving 500 threads takes about 5,000 units,
    nearly a minute's budget. Bulk triage (task 6) should use
    `messages.batchModify` over the summary's message ids, about 50 units per
    1,000 messages.
  - Renaming a parent label renames only that label. Whether Gmail renames
    `Parent/Child` with it is unverified (probe); until then the children
    keep their old prefix.
- **Outcome unknown is reconciled, never retried:**
  - `send`: `rfc822msgid:` search. Found → the sent message; else
    `MailOutcomeUnknownError`.
  - Draft create: the same search over drafts.
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

<!-- AUTOGENERATED:BEGIN — do not edit; regenerated by `./equin build` -->

## Plugin reference

- Description: Registers the Gmail mail provider: MailProvider over integrations/gmail/api, one client and quota pacer per account, Gmail's q compiled from the contract's filter.
- Server:
  - Contributes: `mail.provider` "Gmail"
  - Uses:
    - `apps/mail/provider.MailProviders`
    - `integrations/gmail.getGmailToken`
    - `integrations/gmail/api.createGmailClient`
- Exemptions:
  - Exempts itself from: `endpoints/no-raw-content-disposition` — `server/internal/content.ts` (sanctioned)

<!-- AUTOGENERATED:END -->
