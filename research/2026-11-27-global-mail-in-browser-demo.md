# Mail in the website's live demo

## Context

The user asked to add the Mail app to the website's live demo
(`apps/website/demos/workspace`) with a fake mailbox. The demo runs equin's
real server code in a Web Worker on PGlite. It starts from a snapshot the
build seeds through each app's fixture writer, and the visitor's changes
persist across reloads.

Mail can't join the demo today:

- Its only provider is Gmail, which needs OAuth and Pub/Sub. Gmail's barrel is
  also non-portable: `google-pubsub` uses `Buffer`.
- The in-memory fake is a test helper (`provider/server/testing`). It keeps
  nothing across reloads.
- The reader's barrel is non-portable: its image proxy uses
  `infra/safe-fetch`, which needs `node:dns`.
- Mail is `audience: "developer"`, so the demo's launcher wouldn't list it.

The user decided:

1. A **DB-backed local provider**.
2. **Lift the developer gate everywhere.**
3. **Add a Mail card to the website's Apps gallery.**

## Design

### 1. `apps/mail/providers/local`: a mailbox kept in this host's database

This is a real `MailProvider` (id `local`, label "This device") whose mail lives
in Postgres tables owned by the plugin. It has no network access and needs no
computer, so its server barrel is portable.

- **Tables.** All timestamps are `timestamptz`, so the demo snapshot's time
  shift moves them to now. No epoch integers.
  - `mail_local_accounts`: `id`, `address`, `display_name`, `signature`.
  - `mail_local_mailboxes`: `id`, `name`, `role`, `parent_id`, `color`.
    Role ids come from `roleMailboxId`; others from `nativeMailboxId`.
  - `mail_local_messages`: `id`, `thread_id`, `date`, from / to / cc
    participants (jsonb), `subject`, `text`, `html`, `mailboxes text[]`,
    `unread`, `starred`, `is_draft`, `draft_id`, `rfc822_message_id`,
    `in_reply_to`.
  - `mail_local_attachments`: `message_id`, `part_id`, `filename`, `mime_type`,
    `bytes bytea`, `content_id`. Demo files are small.
  - `mail_local_changes`: `seq bigserial`, `thread_id`, `mailboxes_changed`.
    It is the change log, and the cursor is `seq`.
- **Queries.** The provider query is the canonical filter JSON, as in the fake
  provider (`fakeCompileQuery`, extracted to share). `listMessages` compiles it
  to SQL over `mail_local_messages` with the live filter's SQL half
  (`network/live/filter`, `filterSql` / `renderOpSql`). Column mapping:
  - `mailboxes`: array overlap and contain.
  - The flag columns map directly.
  - `date`.
  - `from` / `to` / `subject`: `ILIKE`.
  - `query`: `ILIKE` over subject, text and from.

  Results are paged by `limit` with an `(date, id)` cursor, so reads stay
  bounded and never scan the whole mailbox in JS.
- **Reads.**
  - `getThreads`: the summary is derived per the contract, its version being
    the max change `seq` of the thread.
  - `getThreadContent`.
  - `getAttachment`.
  - `listMailboxes`: exact counts via SQL.
  - `findMessage`, `findDraft`.
- **Writes.** Each write is a transaction that also appends to
  `mail_local_changes`. Writes are idempotent target-state writes, per
  `MailWriteTarget`:
  - `archive`, `moveToInbox`, `trash`, `untrash`, `setFlags`, `setMailboxes`.
  - Mailbox create / rename / move / colour / delete, where sub-mailboxes move
    up. The capabilities' palette is reused from Gmail's capabilities shape.
  - `saveDraft` / `deleteDraft`.
  - `send`: the RFC 5322 bytes are parsed for headers (To, Cc, Subject,
    In-Reply-To, Message-ID) and the text body. The message is stored in Sent,
    threaded by In-Reply-To / References. It is never delivered anywhere; a
    message to the account's own address also lands in its Inbox. A MIME
    reader is needed: use `packages/mime` if it parses, else add a small
    `parseMimeMessage` there, next to its builder.
- **Changes and push.** `changesSince(seq)` reads the log, paging with `more`.
  `push` is a real `MailPush` that is always `live`: `listen` is called after
  every committed write of this process. This is the in-process change signal,
  so the cache never relies on its fallback tick.
- **Account.** `connectedAccount()` answers the single `mail_local_accounts`
  row, or `not-connected` when there is none.
- **Web half.** A `MailProviderUi.Connect` contribution for `local` that says
  "No local mailbox on this device". It only shows when nothing was seeded.
- **Composition.**
  - `all-exclusions` gets `!apps.mail.providers.local`, so main and the site
    never ship it. The cache's `soleProvider` requires exactly one provider.
  - The demo row opts back in with `apps.mail.providers.local`, and removes
    Gmail with `!apps.mail.providers.gmail.**`.

### 2. `apps/mail/fixtures`: the fixture writer (the Pages / Places pattern)

- `core`: the `MailFixture` type, in Mail's own terms:
  - `account { address, displayName, signature }`.
  - `labels[]` (a path, an optional colour).
  - `threads[]` of `messages[]`. Each message has:
    - `id`, `daysAgo` / `minutesAgo`, `from`, `to`, `cc`, `subject`.
    - `text` and/or `html`.
    - `mailboxes`: role names or label paths.
    - `unread`, `starred`, `draft`.
    - `attachments`: a filename, a type, and bytes or a `data/` path.

  Every id is the caller's.
- `server`: `writeMailFixture(fixture, host)`. It writes the account, then
  creates labels through the real label endpoints (`POST /api/mail/labels` via
  `host.request`, as Places writes tags). Messages are delivered through the
  local provider's own `deliver` write, the inbound counterpart of `send`,
  exported from `providers/local/server`. Delivery is how mail arrives; no
  user endpoint creates received mail.
- The seed never touches the cache's tables. The cache fills on the visitor's
  first open, against already-shifted provider rows. The browser-host test
  asserts the cache tables are empty in the snapshot.

### 3. Mail's server barrels made portable

- **Reader.** Move the image proxy (`handleImage`, the `safe-fetch` import) to
  `reader/machine/`, the way `desktop/wallpaper` does. Declare its endpoint
  `needsMachine: { feature: "Loading remote images" }`. The inline-part and
  attachment routes stay in `server/`. Demo HTML carries only `cid:` and
  `data:` images, so nothing remote is rewritten.
- **Cache and compose.** These are expected to be portable already. The
  build's coverage guard and `serverPortabilityOf` are the arbiters. Whatever
  they name, its computer-bound part moves to `machine/` or is declared
  `needsMachine`. Nothing gets exempted. Compose's attachments need the
  browser's `AttachmentBlobs` provider, which the guard will confirm.
- **Gmail.** Excluded from the demo, so nothing in it changes.

### 4. The developer gate lifted

Drop `audience: "developer"` from `mail/shell/core/app.ts` and update its
`CLAUDE.md` line. On main the rail then shows Mail for every user; with no
account, it draws Gmail's connect surface.

### 5. The demo's mailbox (the story plugin)

The data is in `demos/workspace/plugins/story/core/internal/mail.ts`, exported
as `DEMO_MAIL`. Demo's address is `demo@equin.example`. Every correspondent is
on a `.example` domain, and every id carries `demo`. Mail is what a person gets
that fits the rest of the demo, not mail about equin:

- **Lisbon trip, being planned:**
  - A flight confirmation from a fictional airline, as HTML.
  - A guesthouse booking in Alfama with a PDF. The PDF is the existing
    `data/home/Fado night ticket.pdf`, or a sibling ticket.
  - A thread with a friend sharing tips, which echoes Places' "Friends' tips".
  - Demo's sent reply.
- **Tokyo next:** a rail-pass newsletter, and a friend's question still unread.
- **Piano:** a teacher rescheduling a lesson, with a reply thread of three
  messages, and a recital invite starred.
- **Everyday mail:** a concert hall newsletter (HTML with a `cid:` image), a
  library hold, receipts, a shared photo (an image attachment from
  `data/home/Pictures`), one spam, one trash.
- **A draft reply** in progress, so Continue writing shows.

That makes about 30 threads over the last three weeks, with a mix of unread
and read. Labels are `Travel/Lisbon`, `Travel/Tokyo` (nested, coloured),
`Piano`, `Receipts`. The rows are enough to fill the first page and some of
the Done view.

### 6. Wiring the demo, following its "Adding an app" recipe

- `bin/seed.ts`: `await writeMailFixture(DEMO_MAIL, host)`, then
  `await settleJobQueue()`, after Places. Also add step 10 to its doc comment.
- Composition `agent-manager-demo`: add `apps.mail.**` and
  `apps.mail.providers.local`, plus `!apps.mail.providers.gmail.**`, with a
  comment in the style of the others. Add an `APP_ADAPTERS` entry if Mail has
  adapters.
- `bin/browser-host.test.ts`, a Mail section:
  - The local tables hold `DEMO_MAIL`'s messages and labels.
  - `mail.threads` (the Inbox view) answers the expected first rows through
    the booted graph.
  - `mail.thread` opens one with its attachment.
  - The cache tables were empty at snapshot.
  - The image route is refused as `needsMachine`.
- `demos/workspace/CLAUDE.md`: Mail in the app list and the composition
  paragraph.
- E2E: `landing/screenshot/e2e/mail-in-demo.ts`, copying
  `places-in-demo.ts`. It covers:
  - Opening Mail from the launcher.
  - The Inbox row count from `DEMO_MAIL`.
  - Opening a thread whose HTML body renders.
  - Marking Done and seeing the thread leave the Inbox.
  - Composing and sending, then seeing it in Sent.
  - A reload keeps the change.
  - The `watchPageOrigin` rules: no page-origin `/api`, no off-origin hosts.

### 7. The website gallery card

- `APP_DEMO_PLACES.mail = { home: "/mail", shot: "/mail/thread/<seeded id>" }`
  in `website/pages/apps/core/demo-places.ts`.
- The card in the gallery's catalog.
- `web/shots/app-mail.jpg`, rendered by `website/e2e/app-screenshots.ts`
  against the build.

## Work split

Steps 1 and 3 go first: the provider and portability. Step 5's data can be
written in parallel by a subagent, given the `MailFixture` type. Steps 2, 4, 6
and 7 follow. A single build validates the composition and the coverage guard.

## Verification

- `./equin test` on:
  - `providers/local`: a contract test walking `MAIL_QUERY_OPS`, plus writes,
    changes and send threading. Where it fits, it reuses the cache tests that
    run on the fake.
  - `fixtures`.
  - The workspace `bin/browser-host.test.ts`.
- `./equin build`. The coverage guard must pass with no exemption.
- `./equin run …/mail-in-demo.ts`, on the build and with
  `--site --composition website`.
- Check on the built site, `/about/demo/at/mail`, with screenshots. Register a
  before / after of the gallery with `register_before_after`.
- On the worktree's own main-composition build, Mail shows in the rail
  without Developer mode, and the Gmail flow is unchanged.

## Risks

- **Snapshot time shift.** Only `timestamptz` columns move. Any provider
  column holding time as a number would show stale dates, so all are
  `timestamptz`.
- **Cache freshness on reload.** The cache's catch-up runs `changesSince`
  against the persisted log, so a reload sees the same state.
- **Exclusion of `providers/local`.** If `all-exclusions` misses it, main
  would register two providers and the cache throws at the first read. That
  is loud, and the composition-closure check sees it.
