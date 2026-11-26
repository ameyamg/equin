# Tab recorder: transparent across backend restarts (durable finish, chunk resend, no Unfinished list)

## Context

The extension panel shows an **Unfinished recordings** DataView (added by
`2bbac5eb25`, 2026-11-25). The user's expectation: a recording is transparent
across an app reload — nothing for them to clean up. Today only the *state*
survives a restart (partial + cursor on disk); the *work* does not:

1. `offscreen.ts` `enqueue()`: one failed chunk request → `fail()` → the
   recording stops (`upload-failed`). A redeploy's backend switch, or the
   relay page reloading, is enough.
2. Only the extension drives the finish (remux). A finish that fails, a
   backend dying mid-remux, or a browser closing mid-recording leaves a
   partial nobody finishes → the panel list, Save by hand.

Outcome: chunks ride out a backend switch; the finish is a durable job the
queue carries through restarts; a recording the browser abandoned is finished
by the same job; the Unfinished list, its live value and endpoints' "save
from the panel" paths are deleted.

## Design

### A. Chunk upload survives a backend switch (extension + relay)

- `relay-page.tsx` `serve()`: classify a failure. **Unavailable** =
  `EndpointNetworkError` (no answer), `EndpointError` with status 502/503/504
  (incl. `EndpointForeignAnswerError`, the gateway's page during a switch).
  Everything else (409, 400, 404…) is **refused**.
  `RelayResponseSchema` (`browser-extension/core/recorder.ts`) gains
  `ok:false, retry: boolean`. Only refused failures are reported as crashes
  (`reportRelayFailure`); unavailability is expected control flow.
- `offscreen.ts`: a chunk (and the finish request) that answers `retry:true`,
  or is dropped because the relay page reloaded, is resent — same `seq`, same
  bytes — after a short backoff on awake time (`armAwakeDeadline`,
  0.5 s → 5 s cap). Order is kept (the uploads chain waits). Resending is safe:
  `chunkDecision` already treats a replay of the last chunk as a no-op. The
  bound stays `MAX_QUEUED_BYTES`: equin down longer than the buffer holds →
  `upload-failed`, as today. (A retry is right here: the peer is a backend we
  redeploy on purpose, not our own failing code.)

### B. Finish is a durable job (machine)

- New `recorder.finish` job (`machine/internal/finish-job.ts`, `defineJob`,
  `dedup: { key: id }`, `hold: "minutes"` with an `inProcess` reason: the
  remux is idempotent from the partial, a restart re-runs it). Input is just
  `{ id }` — so a keyed re-enqueue (graphile replace mode) can never clobber
  anything.
- **The finish request lives on disk**, in the cursor: `finishRequested:
  { pointer, durationMs } | null` (`upload-store.ts`). Run:
  1. no upload → done (finished or discarded);
  2. `finishRequested` set → `finishClaimed(upload, pointer)` (today's body
     of `handleFinish`: truncate, fsync, remux, `saveFreePair`), then write
     the outcome row (D);
  3. else, last chunk (`writtenAt`) older than `ABANDONED_AFTER` (1 h) → the
     browser is gone: finish it the same way, pointer `null`;
  4. else re-enqueue itself at `writtenAt + ABANDONED_AFTER` (a deadline,
     not a poll: there is no change signal for "the browser went away").
  The existing disk claim (`.<id>.finishing`) + keyed mutex stay as the
  cross-process guard.
- `handleCreate` enqueues the job at `now + ABANDONED_AFTER`.
- `handleFinish` becomes: write `finishRequested` into the cursor (idempotent;
  a second request re-asserts), enqueue the job now, answer `{ queued }`. If
  the recording is already saved (outcome row exists), answer that.
- **Boot sweep** (machine `onReady`): every partial in the Recordings folder
  whose key is not `finishJob.inFlight(...)` gets a job enqueued — covers
  pre-change partials and anything a lost queue dropped. Partials without a
  cursor (pre-2026-11-25) are finished under their creation time as today.
- A finish that keeps failing (ffmpeg refuses the file) dead-letters → the
  jobs plugin's own failure report. No panel list.

### C. Paused recordings

A pause sends no chunks. A pause longer than `ABANDONED_AFTER` gets finished
as abandoned; a later resume's chunk then answers 409 (refused) → the
recording stops with `upload-failed` and the video holds everything up to the
pause. Accepted limitation, stated in the recorder CLAUDE.md.

### D. Outcome, for the panel's "saved" row

- Table `recorder_saves` (`server/internal/tables.ts`): `id` (recording
  uuid, pk), `path`, `folder`, `name`, `bytes`, `created_at`. Written by the
  job at success. `defineRetention` 7 days, `perWorktree: true`.
- Live value `recorder.save` (`core/`), `params: ["id"]`, `source: "db"`,
  reads `recorder_saves`: `{ state: "pending" } | { state: "saved", … }`.
- Relay `finish` op: POST finish (resent on unavailability like a chunk), then
  wait for `useLive(recordingSave, { id })` to read `saved` (a small React
  child per pending finish in `RelayPage`), and answer `RelayFinished` as
  today. So `offscreen.ts` / `background.ts` / the panel's saved row keep
  their contract; a backend restart mid-remux is just a longer "Saving…".

### E. Delete

- `web/components/unfinished-list.tsx`, `core/unfinished.ts`,
  `machine/internal/unfinished.ts`, its use in `record-section.tsx`, the
  `unfinishedServed.notify()` calls, the `UnfinishedItemActions` slot.
- `handleDiscard`'s "save from the panel" wording; `recordings.ts`'s 409
  text pointing at Unfinished recordings; `salvage()`'s message in
  `offscreen.ts` (a failed salvage finish now just says the job will save
  it — the recording is never lost).
- Descriptions (`machine/index.ts`, `web/index.ts`), recorder `CLAUDE.md`.

## Files

- `plugins/companions/plugins/browser-extension/browser-extension/offscreen.ts`
- `plugins/companions/plugins/browser-extension/core/recorder.ts`
- `plugins/companions/plugins/browser-extension/plugins/recorder/web/components/relay-page.tsx`, `record-section.tsx`, `web/index.ts`
- `plugins/companions/plugins/browser-extension/plugins/recorder/machine/index.ts`, `internal/recordings.ts`, `internal/upload-store.ts`, new `internal/finish-job.ts`
- `plugins/companions/plugins/browser-extension/plugins/recorder/server/index.ts`, new `server/internal/tables.ts`, `core/` (save live value)

Reused: `defineJob` (`infra/jobs/server`), `defineRetention`
(`infra/retention/server`), `serveValue`/`liveValue`, `chunkDecision`,
`claimFinish`/`saveFreePair`, `armAwakeDeadline`, `EndpointError` /
`EndpointNetworkError` (`infra/endpoints/core`).

## Verification

- Unit: `upload-store.test.ts` (finishRequested round-trip), new
  `finish-job.test.ts` decision (requested / abandoned / re-arm / gone),
  relay failure classification.
- On this worktree's build: record via the relay endpoints (the existing
  e2e under `recorder/e2e/`), kill the backend between chunks and during the
  finish's remux; the chunk is resent, the job re-runs, one video lands, no
  partial left. Abandon: create + chunks, no finish, job with a short window
  in the test → video saved.
- `./equin check`, `./equin test` on the recorder and browser-extension paths.
