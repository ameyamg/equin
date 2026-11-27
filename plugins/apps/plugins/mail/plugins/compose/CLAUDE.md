# compose

Writing mail (design §6, step 7 of
[`research/2026-11-26-apps-mail-on-demand-cache-provider.md`](../../../../../../research/2026-11-26-apps-mail-on-demand-cache-provider.md)):
compose, reply, reply all, forward, drafts, attachments and the outbox with
undo send. It names no provider: it writes through the account the cache
serves (`mailCache.sender()`), the bytes built by `packages/mime`.

## The draft is a server row (`mail_drafts`)

- **The working copy is the server's**, one row per draft under an id the
  browser mints (`mdraft-<uuid>`), so the first keystroke has somewhere to go
  with no round trip. The editor holds its own state while open and saves
  after 700 ms quiet, on close, on send and on unmount, one save at a time
  (`PUT /api/mail/drafts/:id`). A save bumps `revision`.
- **The provider's copy follows**: `mail.draft-mirror` (settled per draft:
  2 s quiet, 10 s at most) saves the draft at the provider when its
  `revision` moved past `mirroredRevision` — created the first time, then
  replaced (`saveDraft(…, providerDraftId)`, in the thread it lives in) — so
  a draft is on every device. A discarded draft is a row in state
  `discarded` until the mirror deletes the provider's draft, then the row.
  An empty draft is never mirrored. A create whose answer was lost
  (`draftCreateAttempt` unknown) is looked up by the draft's Message-ID
  (`findMessage` → `findDraft`) before anything is made again, and before a
  send or discard deletes it — a draft is never made twice nor orphaned.
- **Start** (`POST /api/mail/drafts`, idempotent under its id): blank;
  `reply` / `reply-all` / `forward` of a message (`core/internal/reply.ts`,
  `startFrom`: recipients — the Reply-To, else the sender; your own message
  answers its recipients — to you again when it went to you alone; reply
  all adds every other To and Cc, you left out — `Re:` / `Fwd:`,
  In-Reply-To and References (only the `<…@…>` ids a header holds:
  `messageIdsIn`, so an odd received header never blocks a reply), the quote appended at
  build time, a forward's files attached by reference); or `continue` — a
  draft message a thread holds: the local draft mirroring it
  (`providerMessageId`), else the provider's draft found by its message
  (`findDraft`) and adopted (its files copied as uploads).
- Recipient fields are kept as typed and read by `parseAddressList`
  (`core`); the mirror sends the addresses that parse, a send refuses any
  that does not (400, named).
- **Files**: an upload goes to `infra/attachments` and is linked to the
  draft (`mail_drafts_attachments`, so the sweep keeps it); a forwarded
  file is fetched from the provider when the message is built and kept
  under a name-derived id. 25 MB together, at most.

## The outbox: undo send, never twice

- **Send** (`POST /api/mail/drafts/:id/send`) saves the content and queues
  the draft (`queued`, `sendAt` = now + the undo-send delay: Settings →
  Config `mail-compose`, 10 s, the user's call) with a `mail.send` job at
  `sendAt`. **Undo** (`…/undo-send`) takes a queued draft back to
  `editing` (`too-late` once it is being sent).
- **`mail.send`** (its job carries the `sendAt` it was queued for: the job
  of a send undone and made again sends nothing; one run before its time
  throws) claims the draft (`queued` → `sending`, only once its
  time has come), minting the send's own Message-ID, then marks the attempt
  `unknown` BEFORE the provider call. So a crash or a lost answer is
  settled on the next attempt by `findMessage(that id)`, never by sending
  again; only an attempt known not to have reached the provider (offline,
  not connected, refused: `not-sent`) is sent again. Sent: the provider's
  draft is deleted, the cache syncs. Given up (8 attempts): back to
  `editing` with the reason (an `unknown` one says "it may have been sent:
  check Sent") and a notification in the bell.
- A draft and its send carry different Message-IDs (the draft's would be
  found as the draft itself). Gmail renames a sent message anyway: see the
  Gmail provider's `findMessage`.
- **Left out of worktree forks** (declared by the `machine/` half, so the
  server half stays portable): a fork must never send main's queued mail
  or rewrite main's provider drafts. Backed up (user content). Sent drafts
  and reply boxes left untyped are cleared a day after (`mailDraftsRetention`).

## The UI (`web`)

- `ComposeProvider` (the Mail layout wraps the surface in it: the compose
  state is per Mail surface) and `ComposeLayer`: the compose windows
  (bottom right, the prototype's — minimise, To / Cc / Bcc, Subject, the
  body, Send, Attach, Discard; closing saves, an empty one is discarded; at
  most three) and the outbox pill ("Sending…" with Undo, then "Message
  sent"; a send given up reopens its window with the reason). Key `c`.
- `ReplyBox`, the reading pane's foot (`ThreadReader`'s `footer`): Reply to
  the sender (Follow up on your own message), Reply all (more than one
  other party), Forward (a window), or Continue writing when the thread's
  last message is a draft. A reply is written in place (Open in a window
  moves it). Keys `r`, `a`, `f`.
- `ComposeButton`: the sidebar's Compose.
- Bodies are plain text (sent `text/plain`, quoted-printable).

## Who it is written as

Every message built (a draft mirrored, a send) reads the send-as identity of
the account's address (`MailProvider.sendIdentity(address)`; Gmail:
`users.settings.sendAs`, 1 unit) — no Mail setting, no copy: a name or
signature changed in Gmail applies to the next save or send. From is the
account's address under that identity's display name (a primary address with
none of its own: the Google account's name, as Gmail does); sending from an
alias is not offered yet;
its signature, as plain text (`signatureText`), goes under `-- ` between the
body and a reply's quote (`messageText`), unless the body is signed already (a
line that is the `-- ` delimiter, `bodySigned`: a draft written in Gmail's
editor and adopted).

The editor shows the signature as a block of its own under the body
(`SignatureBlock`, compose window and reply box alike) — never as body text,
so an untouched compose stays empty (never mirrored, discarded on close). It
reads `mail.signature` (`load: "snapshot"`: the provider's settings have no
change signal, so it is read when an editor opens; the message built reads
it again). Removing it is this message's choice only: the draft's
`content.signature` (saved with the draft, `true` for a draft saved before
the choice existed) — false, its mirrored draft and its send go unsigned; the
footer's Add signature puts it back.

<!-- AUTOGENERATED:BEGIN — do not edit; regenerated by `./equin build` -->

## Plugin reference

- Description: The Mail app's compose, web half: ComposeLayer — the compose windows over the Mail surface (the prototype's, bottom right: minimise, To / Cc / Bcc / Subject, the body with the account's signature as a block under it — removable for this message, Add signature puts it back — Send, Attach, Discard; closing saves the draft, an empty one is discarded; the c key) and the outbox pill (Sending… with Undo for the undo-send delay, which reopens the draft, then Message sent; a send given up reopens it with its reason) — ComposeButton (the sidebar's Compose) and ReplyBox (the reading pane's foot: Reply / Follow up, Reply all, Forward, or Continue writing on a draft; a reply written in place, Open in a window; the r, a and f keys). Every editor saves into its server draft as it is typed (mail.draft), which the server mirrors to the provider's drafts; registers the undo-send delay for Settings → Config. The Mail app's compose, server half: mail_drafts — each draft's working copy (recipients as typed, subject, body, files, the thread it answers, In-Reply-To / References and the quote of what it answers) and the outbox — mail.draft (one draft, pushed on every save), mail.signature (the account's signature as the editor shows it, read from the provider when an editor opens), and the writes: start (blank, reply, reply all, forward — recipients, Re:/Fwd:, quote and threading derived from the message answered — or continue a draft message a thread holds, adopting a draft made elsewhere), save, send (queued for the undo-send delay, Settings → Config mail-compose, 10 s by default), undo send and discard; mail.draft-mirror (settled per draft) copies a draft to the provider's drafts and deletes it there on discard; mail.send sends a due draft through the provider, built by packages/mime, never twice (claimed before the call, its own Message-ID, a lost answer settled with findMessage), and a send given up reopens the draft with the reason and a notification. Left out of worktree forks.
- Web:
  - Contributes:
    - `IdKinds.Kind` "mdraft"
    - `ConfigV2.WebRegister` "mail-compose"
  - Uses: 27 symbols — full list in [REFERENCE.md](./REFERENCE.md)
    - `primitives/css/ui-kit` ×5
    - `primitives/css/fill` ×2
    - `primitives/css/spacing` ×2
    - `config_v2.ConfigV2`
    - `ids.IdKinds`
    - `infra/attachments.uploadAttachment`
    - `infra/endpoints.useFetchEndpoint`
    - `network/live/live-state.matchResource`
    - `network/live.useLive`
    - `primitives/css/line.Line`
    - `primitives/css/pin.Pin`
    - `primitives/css/rigid.rigidClass`
    - `primitives/css/row.Row`
    - `primitives/css/surface.Surface`
    - `primitives/css/text.Text`
    - `primitives/icon-button.IconButton`
    - `primitives/loading.Loading`
    - `primitives/scope/scoped-store.defineScopedStore`
    - `primitives/shortcuts.useSurfaceShortcuts`
    - `shell/notifications.useToast`
    - `ui/icons.Icon`
  - Exports (types): `ReplyThread`
  - Exports (values):
    - `ComposeButton`
    - `ComposeLayer`
    - `ComposeProvider`
    - `ReplyBox`
- Server:
  - Contributes:
    - `ids.kind` "mdraft"
    - `resource.declare` "mail.draft"
    - `resource.declare` "mail.draft-attachment-links"
    - `resource.declare` "mail.draft-attachment-links:rows"
    - `resource.declare` "mail.signature"
    - `attachments.link` "mail_drafts"
    - `ConfigV2.Register` "mail-compose"
    - `fork-data-exclusion` "mail_drafts"
    - `fork-data-exclusion` "mail_drafts_attachments"
  - Uses: 24 symbols — full list in [REFERENCE.md](./REFERENCE.md)
    - `infra/attachments` ×4
    - `config_v2` ×2
    - `database/derived-updated-at` ×2
    - `database/sql-column` ×2
    - `ids` ×2
    - `infra/endpoints` ×2
    - `infra/jobs` ×2
    - `infra/retention` ×2
    - `network/live` ×2
    - `apps/mail/cache.mailCache`
    - `database.db`
    - `fields/date/format.serverDateFormatter`
    - `shell/notifications.recordNotification`
  - DB schema:
    - `plugins/apps/plugins/mail/plugins/compose/server/internal/schema-attachments.ts`
    - `plugins/apps/plugins/mail/plugins/compose/server/internal/tables.ts`
  - Exports (values):
    - `_mailDraftAttachmentsTable`
    - `_mailDrafts`
  - Register:
    - `defineJob('mail.draft-mirror')`
    - `defineJob('mail.send')`
    - `defineJob('retention.mail_drafts')`
  - Resources:
    - `mail.draft` (push, capped: MAIL_DRAFT_ATTACHMENTS_MAX)
    - `mail.draft-attachment-links` (keyed)
    - `mail.draft-attachment-links:rows` (keyed, point)
    - `mail.signature` (invalidate, snapshot)
  - Routes:
    - `POST /api/mail/drafts`
    - `PUT /api/mail/drafts/:id`
    - `POST /api/mail/drafts/:id/send`
    - `POST /api/mail/drafts/:id/undo-send`
    - `DELETE /api/mail/drafts/:id`
- Core:
  - Uses:
    - `config_v2.defineConfig`
    - `fields/int/config.intField`
    - `ids.defineIdKind`
    - `ids.IdOf`
    - `infra/attachments.ATTACHMENT_LINKS_MAX`
    - `infra/attachments.attachmentLinkFields`
    - `infra/endpoints.defineEndpoint`
    - `infra/entities.entityRef`
    - `infra/html-decode.decodeHtmlText`
    - `network/live.liveCollection`
    - `network/live.liveValue`
    - `network/live/query-resource.compositeKey`
    - `packages/list-bound.cappedList`
  - Exports (types):
    - `AddressListParse`
    - `DraftAttachment`
    - `DraftContent`
    - `DraftKind`
    - `DraftStart`
    - `DraftStartContent`
    - `DraftState`
    - `MailDraft`
    - `MailDraftId`
  - Exports (values):
    - `bodySigned`
    - `discardMailDraft`
    - `DRAFT_KINDS`
    - `DRAFT_STATES`
    - `DraftAttachmentSchema`
    - `DraftContentSchema`
    - `DraftStartSchema`
    - `EMPTY_DRAFT_CONTENT`
    - `formatAddressList`
    - `htmlToPlainText`
    - `isDraftEmpty`
    - `MAIL_ATTACHMENTS_MAX_BYTES`
    - `MAIL_DRAFT_ATTACHMENTS_MAX`
    - `MAIL_DRAFT_REFUSALS`
    - `mailComposeConfig`
    - `mailDraft`
    - `mailDraftAttachmentLinks`
    - `mailDraftAttachmentLinksEntityRef`
    - `mailDraftIdKind`
    - `MailDraftSchema`
    - `mailSignature`
    - `messageIdsIn`
    - `messageText`
    - `parseAddressList`
    - `plainTextOf`
    - `prefixedSubject`
    - `quoteOf`
    - `saveMailDraft`
    - `sendMailDraft`
    - `signatureText`
    - `startFrom`
    - `startMailDraft`
    - `undoSendMailDraft`
- Cross-plugin:
  - Uses tokens:
    - `ui/tokens/color-palette --border`
    - `ui/tokens/color-palette --destructive`
    - `ui/tokens/color-palette --foreground`
    - `ui/tokens/color-palette --input`
    - `ui/tokens/color-palette --muted-foreground`
    - `ui/tokens/color-palette --primary-text`
    - `ui/tokens/density --space-2xs`
    - `ui/tokens/density --space-lg`
    - `ui/tokens/density --space-md`
    - `ui/tokens/density --space-smd`
    - `ui/tokens/density --space-xsm`
    - `ui/tokens/shape --radius-control`
    - `ui/tokens/shape --spacing`
    - `ui/tokens/type-scale --font-weight-label-strong`
    - `ui/tokens/type-scale --font-weight-semibold`
  - Imported by:
    - `apps/mail/shell`
    - `apps/mail/threads`
- Exemptions:
  - Exempts itself from: `no-db-backed-notify` — `server/internal/served.ts` (sanctioned)

<!-- AUTOGENERATED:END -->
