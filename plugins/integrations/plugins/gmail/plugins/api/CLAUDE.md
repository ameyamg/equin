# gmail/api

A **stateless, typed Gmail REST client** for one account. It takes an
access-token getter and the account's quota pacer, and never touches auth,
storage or the DB. Its consumer is the Mail app's Gmail provider (design:
[`research/2026-11-26-apps-mail-on-demand-cache-provider.md`](../../../../../../research/2026-11-26-apps-mail-on-demand-cache-provider.md),
task 1), which gets the token from the parent plugin (`getGmailToken`).

## Public API

- **`server`** — `createGmailClient({ accessToken, pacer, fetch?, retry? })`:
  - account and labels: `getProfile`, `listSendAs` (the send-as identities:
    display name, HTML signature, default), `listLabels` (no counts), `getLabel` /
    `getLabels` (batch; exact `threadsTotal` / `threadsUnread`),
    `createLabel` / `patchLabel` / `deleteLabel`;
  - threads: `listThreads` (ids with each thread's `historyId`),
    `getThread` / `getThreads` (batch) in `minimal` | `metadata` | `full`,
    `modifyThread`, `trashThread` / `untrashThread`;
  - messages: `listMessages`, `getMessage` / `getMessages` (batch, `raw`
    too), `modifyMessage` / `trashMessage` / `untrashMessage` (one
    message, its thread's others untouched),
    `batchModifyMessages` (≤ 1,000 ids), `getAttachment` (bytes),
    `sendMessage` (RFC 2822 bytes);
  - `listHistory` — one page, or `{ kind: "expired" }` when Gmail answers
    404 for a cursor older than its history (the caller resyncs);
  - drafts: `listDrafts`, `getDraft`, `createDraft` / `updateDraft` (RFC 2822
    bytes), `deleteDraft`, `sendDraft`;
  - push: `watch` (Cloud Pub/Sub topic) and `stopWatch`.
  - Every method takes `{ priority?, signal? }` last (`GmailCallOptions`).
- **`core`** — the pacer (`createQuotaPacer`), the quota table
  (`GMAIL_QUOTA`, `GMAIL_USER_UNITS_PER_MINUTE`), the batch codec, the error
  classes, base64url, the zod schemas and their types (`GmailThread`,
  `GmailMessage`, `GmailMessagePart`, `GmailLabel`, …). Pure, any host.

## Quota pacing (`createQuotaPacer`)

Gmail's budget is 6,000 units per user per minute, and every call has a price
(`GMAIL_QUOTA`: `threads.list` 10, `threads.get` 40 / 120 `full`,
`messages.get` 20 / 60, `history.list` 2, `messages.send` 100…). A batch is
charged per call. The pacer:

- keeps a **sliding 60 s window** of admitted units. A call is charged
  *before* it is sent, because Google counts refused calls too;
- runs one FIFO queue per priority, strictly in order (a head that does not
  fit holds every tier below it):
  - **`foreground`** — a person waits on it;
  - **`background`** — upkeep that keeps what is shown correct (a sync step,
    a re-list): admitted only while no foreground call waits and while its
    OWN charges fit in `backgroundShare` (default ½) of the window;
  - **`speculative`** — work that may be wasted (body prefetch): admitted
    only while nothing above it waits and the WHOLE window, every tier
    counted, fits in `speculativeShare` (default half of
    `backgroundShare`): it spends only what is idle;
  - so foreground always finds `1 − backgroundShare − speculativeShare` no
    lower tier can hold, and speculative charges never count against
    background's share — prefetch never delays a sync step. Before this
    tier, prefetch shared the background FIFO and share, and a 2-unit sync
    step waited 53 s behind it (task-1795743099-v6pv5z);
- **pauses every caller** when Google refuses one call for rate (429, or 403
  `rateLimitExceeded` / `userRateLimitExceeded`), for `Retry-After` or the
  backoff delay;
- refuses a call that could never fit (larger than its window share), and
  throws instead of queueing it forever.

Make **one pacer per account per process**, and hand it to every client of
that account. Two pacers over one account would each spend the whole budget.

## Batch and backoff

- `getThreads` / `getMessages` / `getLabels` send ≤ 20 calls per
  `POST /batch/gmail/v1` (`GMAIL_BATCH_MAX`), and ≤ half the priority's
  window in units (`pacer.capacity`), with the chunks one after another.
  - Not Google's "50 or fewer": Google runs a batch's parts at once and
    refuses for rate the ones past a per-user concurrency it does not publish,
    and every refused part is charged again when re-sent. Measured on the real
    account (2026-11-26, `scripts/batch-shape-probe.ts`): 50 parts → 24 of 50
    refused (a 50-thread page cost ~2,760 units, not 2,000); 40 → 2, 30 → 4;
    25 and 20 → none. Three sequential batches of 20 are as fast as one of 50.
  - So no chunk is one the pacer refuses.
  - None holds a whole minute while a click waits behind it.
- The answer is **one result per id, in order**: `{ ok: true, value }` or
  `{ ok: false, error }`. A thread deleted since it was listed is a 404 beside
  the others, never a throw for the page. The same holds for one item of an
  undocumented shape (`GmailResponseShapeError`).
- A part refused for rate or failed on Google's side is **retried alone**.
- The backoff is a *bound around Google*, not a fix for our code. These are
  tried at most `retry.attempts` (5) times, then thrown:
  - 429, a rate 403, and 5xx;
  - Google unreachable (`GmailUnreachableError`).
- The delay is `Retry-After` when Google names one, else 1 s doubling to 32 s
  with jitter. Any other refusal throws `GmailApiError` at once, with Google's
  `reason` and message.
- **A call that must not happen twice is never re-sent after Google may have
  done it.** Each call declares `replay`:
  - `safe`: reads, and writes that set a target state (modify, trash,
    update, delete).
  - `rate-only`: `messages.send`, `drafts.send`, `drafts.create` and
    `labels.create`. These retry only a rate refusal, where Google did
    nothing.
  - A dropped connection or a 5xx on a `rate-only` call throws
    `GmailOutcomeUnknownError`. The caller reconciles (Sent, history) instead
    of sending again.
- **A 401 is sent once more with a refreshed token.** The getter is asked
  again with `{ refused: <the token Google refused> }`, and the broker
  (`getGmailToken({ refused })` → auth central) refreshes if it still holds
  that token. A 401 means Google did nothing, so even a send may go again. A
  second 401 throws `GmailApiError` (status 401): the grant is gone. Batch
  parts refused with 401 inside an accepted batch go once more the same way
  (only those parts).
- An abort cuts a backoff wait short.
- **Waits are metered** in the runtime profiler, named by layer in the trace
  of the request that awaited them: `gmail-quota` (a `queue` wait, only while
  the pacer holds a call because its minute is spent; `acquire`'s
  `onQueued`), `gmail-rate-pause` (a `queue` wait held by the pacer's pause
  after Google refused a call for rate — the account's budget spent by more
  than this pacer saw, usually another process on the same account; named by
  what held the call as it queued), `gmail-backoff` (a `queue` wait: the delay before
  re-sending a 5xx or an unreachable call) and `gmail-api` (an `io` wait: the
  HTTP round trip — still the waiter's own time unless it is filed). Queue
  waits are not the waiter's own time.
- The pacer runs on a monotonic clock (`performance.now`).
- A 2xx answer whose shape Gmail does not document throws
  `GmailResponseShapeError`. The client never guesses.

## Tests and the probe

- Tests replay answers in Google's exact wire shape, with made-up content
  (`server/internal/fixtures/`), through an injected `fetch`. No test calls
  Google.
- `scripts/probe.ts` (`./equin run …/probe.ts [--threads 50] [--label INBOX]`)
  makes read-only calls against the connected account: profile, labels, one
  list page, that page's metadata in one batch, history, one `full` thread, one
  attachment, and drafts.
  - It prints each step's wall time and quota units, with results as counts
    only.
  - It needs Gmail access granted in Settings.
- `scripts/batch-shape-probe.ts` (`--shapes 50x1,25x1,10x5`) sends one Inbox
  page's `threads.get` metadata as raw batches of each shape (size × in
  flight), with no retry, a fresh minute apart, and prints how many parts
  Google refused for rate. What `GMAIL_BATCH_MAX` is measured with.

<!-- AUTOGENERATED:BEGIN — do not edit; regenerated by `./equin build` -->

## Plugin reference

- Description: Stateless typed Gmail REST client: createGmailClient({ accessToken, pacer }) — profile, labels, threads, messages, history (an expired cursor is a typed outcome), drafts, send (multipart upload), attachments, modify and watch; reads batched ≤20 per HTTP request (past that Google refuses parts for rate) with a per-id result; every call charged on the account's quota pacer before it is sent and retried within a bound on Google's 429 / 5xx / rate-limit 403; every answer zod-parsed.
- Cross-plugin:
  - Imported by: `apps/mail/providers/gmail`
- Server:
  - Exports (types):
    - `GmailBatchResult`
    - `GmailCallOptions`
    - `GmailClient`
    - `GmailHistoryPage`
    - `GmailHistoryType`
    - `GmailLabelChange`
    - `GmailLabelInput`
    - `GmailListQuery`
    - `GmailOutgoing`
    - `GmailReadFormat`
    - `GmailThreadFormat`
    - `GmailTransportOptions`
  - Exports (values):
    - `createGmailClient`
    - `GMAIL_API_ROOT`
- Core:
  - Exports (types):
    - `BatchRequestPart`
    - `BatchResponsePart`
    - `GmailDraft`
    - `GmailDraftRef`
    - `GmailFormat`
    - `GmailHeader`
    - `GmailHistoryRecord`
    - `GmailLabel`
    - `GmailMessage`
    - `GmailMessageLabels`
    - `GmailMessageList`
    - `GmailMessagePart`
    - `GmailMessageRef`
    - `GmailMethod`
    - `GmailPriority`
    - `GmailProfile`
    - `GmailSendAs`
    - `GmailSentMessage`
    - `GmailThread`
    - `GmailThreadLabels`
    - `GmailThreadList`
    - `GmailThreadRef`
    - `GmailWatch`
    - `PacerWaitReason`
    - `QuotaPacer`
    - `QuotaPacerOptions`
    - `QuotaPacerStats`
  - Exports (values):
    - `AttachmentSchema`
    - `createQuotaPacer`
    - `decodeBase64Url`
    - `decodeBatch`
    - `DraftListSchema`
    - `DraftRefSchema`
    - `DraftSchema`
    - `EmptySchema`
    - `encodeBase64Url`
    - `encodeBatch`
    - `encodeRelatedUpload`
    - `ErrorEnvelopeSchema`
    - `GMAIL_BATCH_MAX`
    - `GMAIL_QUOTA`
    - `GMAIL_USER_UNITS_PER_MINUTE`
    - `GmailApiError`
    - `GmailBatchFormatError`
    - `GmailOutcomeUnknownError`
    - `GmailResponseShapeError`
    - `GmailUnreachableError`
    - `HeaderSchema`
    - `HistoryIdSchema`
    - `HistoryListSchema`
    - `HistoryRecordSchema`
    - `LabelListSchema`
    - `LabelSchema`
    - `LabelWriteAnswerSchema`
    - `MessageLabelsSchema`
    - `MessageListSchema`
    - `MessagePartSchema`
    - `MessageRefSchema`
    - `MessageSchema`
    - `newBatchBoundary`
    - `ProfileSchema`
    - `SendAsListSchema`
    - `SendAsSchema`
    - `SentMessageSchema`
    - `ThreadLabelsSchema`
    - `ThreadListSchema`
    - `ThreadRefSchema`
    - `ThreadSchema`
    - `WatchResponseSchema`

<!-- AUTOGENERATED:END -->
