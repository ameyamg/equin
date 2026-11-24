# Chrome window recorder (browser extension → recordings store)

Status: plan. Scope: record the equin Chrome tab (or any tab) from the equin
extension, at an exact viewport size, and land the file on the machine where a
future video editor app lists it. Chrome only; no native ScreenCaptureKit.

## Context

The user wants to share short videos of equin, and later cut them in a video
editor app (prototyped separately). Screen recorders (QuickTime, CleanShot) record
whatever size the window happens to be, include other windows, and leave files
nowhere equin knows about. The extension already sits in Chrome's toolbar, frames
an equin page (`/home/browser-extension`) and has a bridge to privileged Chrome
APIs, so it is the natural recorder: one click, the exact tab, an exact size,
straight into equin's own storage.

Decided (not re-opened here): capture with `chrome.tabCapture` from the extension
(the click in the panel is the gesture, no picker), and **viewport presets**:
before recording, `chrome.windows.update` resizes the window so the tab's
viewport is an exact CSS size, and puts the old bounds back afterwards.

## Approach

Three cooperating pieces, each with one job:

1. **The shell grows a recorder** (`browser-extension/browser-extension/`): a
   service worker (`background.ts`) that owns the recording session (resize,
   stream id, badge, restore, keyboard command), and an offscreen document
   (`offscreen.html/ts`, reason `USER_MEDIA`) that turns the stream id into a
   `MediaStream` and runs `MediaRecorder`. The popup only forwards the panel's
   Start / Stop over the existing bridge. The popup closes as soon as the user
   clicks back into the page, so nothing about the session may live in it.
2. **Uploads go through an equin page, not the extension.** A fetch from
   `chrome-extension://…` reaches the gateway as `Sec-Fetch-Site: cross-site`,
   which `gateway/principal.go` reads as **anonymous**, so writes are refused. The
   shell's rule is that it "never calls equin" (`browser-extension/CLAUDE.md`). So
   the offscreen document frames a hidden equin route
   (`/home/browser-extension/recorder?embed=1`) and hands it each chunk over a
   `MessagePort`, using the same hello → port handshake and `acceptBridgePort`
   origin check as the popup. That page POSTs the chunks same-origin, as the
   owner. No change to the trust model or the gateway.
3. **A recordings store** (`plugins/media/plugins/recordings`): a `recordings`
   table served as a live collection (DataView-ready, which is how the editor will
   list recordings), a host-global data dir holding the bytes, append-only chunk
   upload endpoints, a finalize job (ffmpeg remux to faststart MP4, ffprobe
   metadata, a poster frame), and a Range-capable file asset route for `<video>`.

The panel shows the recording's progress by reading the recording row live
(`useLive(recordings, { id })`: status, bytes, started at) rather than asking the
extension. One source of truth, push-based, and it survives the popup closing.

## Plugins & files

### New: `plugins/media/plugins/recordings` (the store; the editor's input)

- `core/`
  - `recordingsEntityRef` + `recordings = liveCollection("media.recordings", …)`:
    a default `limit`/`maxLimit`, ordered by `startedAt desc`. Fields: `id`
    (`rec-…`, a `defineIdKind`), `status` (`recording | processing | ready |
    failed | interrupted`), `title` (source tab title), `sourceUrl`, `preset`,
    `cssWidth`/`cssHeight`, `dpr`, `width`/`height` (physical, read from the
    track), `fps`, `mimeType` (as recorded), `bytes`, `durationMs`, `startedAt`,
    `endedAt`, `error`, `hasAudio`, `hasCursorTrack`.
  - Endpoints (`defineEndpoint`, `needsMachine: { feature: "Recording a tab" }`):
    - `POST /api/recordings`: JSON meta, answers `{ id }`. Creates the row with
      status `recording`.
    - `POST /api/recordings/:id/chunks/:seq`: `blob()` body, appended to
      `<id>.raw`. `seq` must equal the next expected one. A replay of the last
      `seq` with the same size is a no-op. Anything else is a 409: fail loudly,
      never reorder.
    - `POST /api/recordings/:id/cursor`: NDJSON pointer samples, appended (see
      the cursor question below).
    - `POST /api/recordings/:id/finish`: `{ durationMs, reason: "stopped" |
      "track-ended" | "error", error? }` sets status `processing` and enqueues
      the finalize job.
    - `GET /api/recordings/:id/file` and `/poster`: `blob()` responses, loaded as
      assets (`assetPath`, like `getAttachmentFile` in
      `plugins/infra/plugins/attachments/core/internal/file-endpoint.ts`).
      These are byte assets, not data reads, so `live/no-endpoint-read` does not
      apply.
  - Tiny pure helpers: `recordingFileName(id, kind)` and the status union.
- `server/`: the drizzle `recordings` table (in the schema glob), `serveCollection(recordings, …)`.
  Portable: rows only.
- `machine/`: the routes above (`implementMachine`, the pattern in
  `plugins/screenshot/machine/internal/handle-save-file.ts`). They write into the
  data dir (open in append mode per chunk, `fsync` on finish). The file route uses
  `rangedBlobResponse` (`plugins/infra/plugins/endpoints/core/byte-range.ts`) and
  the inert headers pattern (`plugins/infra/plugins/host-fs/server/internal/raw.ts`).
  The `recordings.finalize` job (`defineJob`) does `ensureDep(ffmpeg, exec)`
  (`plugins/media/plugins/ffmpeg/deps`; the job-side usage is in
  `plugins/integrations/plugins/youtube/server/internal/search.ts`), then:
  - `ffmpeg -i <id>.raw -c:v copy -c:a aac -movflags +faststart <id>.mp4`
    (re-encode video only if the codec is not H.264);
  - `ffprobe` for the duration and dimensions;
  - one poster JPEG;
  - then the row becomes `ready` and the raw file is deleted. On failure the row
    becomes `failed` with the error, and the raw file is **kept**.
- `data-dirs/`: `defineDataDir({ kind: "state", name: "recordings", reclaim: {
  kind: "never", reason: "the only copy of each recording" } })`. It is host-global
  like `state/attachments`, so files are named by id and a worktree's rows never
  collide with main's. Later, add it to the backup plugin's sources (open question).

### New: `plugins/companions/plugins/browser-extension/plugins/recorder` (panel UI + upload relay)

- `web/`
  - The `BrowserExtension.Section` "Record", added to
    `config/companions/browser-extension/section.jsonc` after Wish. It shows:
    - the preset chips (Landscape 1280×720, Shorts 9:16, Current size);
    - fps (30/60) and a Tab audio toggle;
    - Start;
    - while recording, the live row's elapsed time / size and a **Stop** button;
    - the last ready recording (Open / Copy path).
    It is hidden unless `host.info.capabilities.record`.
  - The relay route `/home/browser-extension/recorder` (registered under the
    browser-extension app's panes; chromeless, never listed). It accepts the
    offscreen document's port and serves `create`, `chunk`, `cursor` and `finish`
    by calling the endpoints above through `useFetchEndpoint`/`fetchEndpoint`. It
    sends chunks one at a time, in order, and acks each so the offscreen side can
    apply backpressure.
- It reads `media/recordings/core` (live collection + endpoints).

### Modified: `plugins/companions/plugins/browser-extension`

- `browser-extension/manifest.json`:
  - `permissions` add `tabCapture`, `offscreen`, `scripting`, `storage`;
  - add `background: { service_worker: "background.js", type: "module" }`;
  - add `commands: { "toggle-recording": { suggested_key: "Alt+Shift+R" } }`.
- `browser-extension/background.ts` (new): session owner, see the flow below.
- `browser-extension/offscreen.html` + `offscreen.ts` (new): MediaRecorder, and
  the iframe of the relay route.
- `browser-extension/popup.ts`: new bridge methods forwarded to the worker
  (`chrome.runtime.sendMessage`).
- `core/bridge.ts`:
  - capability `record`;
  - methods `recorderState`, `startRecording({ preset, fps, audio })`, `stopRecording`;
  - `RecorderStateSchema` (`idle | preparing | recording { recordingId, startedAt } | stopping`).
- `core/recorder.ts` (new): the worker ↔ offscreen ↔ relay message schemas
  (zod, both sides parse), and the `ViewportPreset` closed list (plain data,
  per the closed-list rule).
- `core/viewport.ts` (new, pure + tested): `windowBoundsFor(preset, measured)`,
  where `measured = { outerW, outerH, innerW, innerH, zoom, workArea }`. It
  answers `{ ok: true, bounds } | { ok: false, reason: "does-not-fit" | "zoomed" }`.
- `cli/internal/write-shell.ts`: bundle three entrypoints (`popup.ts`,
  `background.ts`, `offscreen.ts`) and copy `offscreen.html`. The digest already
  covers every shipped file.
- `web/host.ts`: expose `startRecording` / `stopRecording` / `recorderState` on
  the `present` host when `record` is on.
- `CLAUDE.md`: the "No service worker" line changes. Document the recorder half
  and the relay.

### Reuse

- `media/player` to preview a recording (editor app and Open).
- `media/ffmpeg` deps for the remux and probe.
- `infra/endpoints` `blob()` codec, `rangedBlobResponse`, `implementMachine`,
  `HttpError`.
- `infra/jobs` `defineJob` for finalize.
- The bridge handshake (`acceptBridgePort`, `BRIDGE_HELLO`).
- `primitives/data-view` for any list of recordings.

## Recording flow

1. **Start.** The panel (in the popup iframe) calls
   `host.startRecording({ preset, fps, audio })`. The popup forwards it to the
   worker, which answers at once with `preparing`. The popup may close from here
   on.
2. **Measure.** The worker:
   - takes the active tab (`activeTab` was granted by the popup's open, for this
     tab until it navigates);
   - reads `chrome.windows.get(tab.windowId)`;
   - runs `chrome.scripting.executeScript` in the tab for `innerWidth`,
     `innerHeight` and `devicePixelRatio`;
   - reads `chrome.tabs.getZoom`;
   - reads the display work area (`screen.availWidth/Height` from that same
     script).
3. **Resize.** The worker saves `{ windowId, left, top, width, height, state }`
   to `chrome.storage.session`, because the worker can be killed mid-recording.
   It sets `state: "normal"` if the window was maximized or fullscreen, then
   `chrome.windows.update` to `windowBoundsFor(…)`. It waits for
   `chrome.windows.onBoundsChanged` (push, no timer), re-measures, and if
   `innerWidth/Height` is still off it corrects once by the residual. Still off
   means it fails loudly: the badge shows `ERR` and the panel shows why (next
   open).
4. **Stream.** The worker:
   - calls `chrome.tabCapture.getMediaStreamId({ targetTabId })`;
   - calls `chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["USER_MEDIA"] })`
     (one per extension; reuse it if it exists);
   - posts `{ streamId, physical: css×dpr, fps, audio }`.
5. **Record.** The offscreen document:
   - calls `getUserMedia({ video: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId, min/maxWidth, min/maxHeight, maxFrameRate } }, audio: audio ? {…tab} : false })`;
   - asserts `track.getSettings()` equals the expected physical size (fail
     loudly);
   - if audio is on, routes it back to an `AudioContext.destination` (tabCapture
     mutes the tab otherwise);
   - opens the relay iframe and waits for its hello / port;
   - sends `create` and gets the `recordingId`;
   - runs `MediaRecorder.start(1000)` with
     `mimeType = first supported of ["video/mp4;codecs=avc1,mp4a" (Chrome ≥126), "video/webm;codecs=h264,opus", "video/webm;codecs=vp9,opus"]`
     and `videoBitsPerSecond ≈ 12–16 Mbps @1440p30`;
   - sends each `dataavailable` chunk's `ArrayBuffer` (transferred) as
     `chunk(seq)`, strictly serial.
6. **Indicate.** The worker sets the badge to `REC` (red). Chrome also draws its
   own tab-capture indicator. The panel, on the next popup open, reads
   `recorderState` from the worker and the row live from the server.
7. **Stop.** Any of these stops the recording:
   - the panel's Stop button;
   - the `toggle-recording` command;
   - the track `ended` event (tab closed);
   - an upload failure.

   Then the offscreen document runs `recorder.stop()`, flushes the last chunk
   and sends `finish({ durationMs, reason })`. The worker restores the saved
   window bounds and state, clears the badge, and closes the offscreen document.
8. **Finalize.** The server's `recordings.finalize` job produces the MP4 and
   poster and marks the row `ready`. Every surface reading `media.recordings`
   updates by push.

Backpressure: the offscreen side keeps a bounded queue (say 64 MB). If the
instance is unreachable and the queue fills, it stops the recording with an
`error` finish attempt and the badge shows `ERR`. It never buffers unbounded and
never drops silently. Everything already appended stays recoverable, because
ffmpeg can remux a truncated raw file.

## Viewport presets

| Preset | CSS viewport | Captured @2x (Retina) | Use |
|---|---|---|---|
| Landscape (default) | 1280×720 | 2560×1440 | demos, YouTube, X |
| Shorts 9:16 | 540×960 | 1080×1920 | Shorts / Reels / TikTok |
| Current size | as is | as is | no resize |

- **Window bounds:** `outer − inner` is the chrome delta (tab strip, toolbar,
  bookmarks bar, frame), measured live because it varies with the bookmarks bar,
  the profile and full-screen state. Target outer size = CSS size + delta.
- **Zoom:** `innerWidth` is in zoomed CSS pixels. A tab not at 100% zoom is
  refused (`zoomed`), or the panel offers to reset it with
  `chrome.tabs.setZoom(tab, 1)`. Do not silently compensate.
- **Fit:** 9:16 at 540×960 plus about 90 px of chrome does not fit a 14" MacBook's
  default 982 pt height. `windowBoundsFor` returns `does-not-fit`, and the chip is
  disabled with a reason. A fallback (open question) is a smaller 9:16 CSS size
  (450×800 → 900×1600) upscaled at export, or DevTools emulation (below).
- **DPR 1 display:** the same CSS sizes capture at 1×. The recording stores the
  actual physical size, and the panel shows "1280×720 (1×)" so that is no
  surprise.
- **During recording:** the size is locked. A manual resize mid-recording
  changes the track size. Detect it with the track's `resize`/settings or the
  worker's `onBoundsChanged`, then stop with reason `resized` rather than produce
  a variable-resolution file.

## Storage & hand-off to the editor

- **Bytes:** `~/.equin/state/recordings/<rec-id>.mp4` (+ `.jpg` poster,
  `.cursor.ndjson`; `.raw` only while recording or after a failed finalize).
- **Rows:** `recordings` in the instance's DB, which in practice is main's,
  because the installed extension frames main. The `media.recordings` live
  collection is the editor's single input:
  - `useLive(recordings, { limit })` drives a DataView;
  - `assetPath(getRecordingFile, { id })` feeds `media/player` (Range-served, so
    seeking works);
  - the metadata (CSS size, DPR, fps, source URL/title, cursor track) is what an
    editor needs to crop, zoom and redraw a cursor.
- The store has no UI of its own beyond the panel's "last recording". The
  editor app (or interim a Debug pane / the Files app) owns browsing. Delete =
  a write endpoint later, through `infra/trash` when the editor exists.

## Open questions / risks

- **Cursor is not in tabCapture output.** The proposal is a cursor sidecar: a
  content script (injected with `scripting` into the recorded tab) samples
  `pointermove` / `pointerdown` / `pointerup` with `performance.now()` offsets
  relative to the recorder's start. It sends them through the worker to the
  offscreen document and on to the relay `cursor` endpoint. The editor then
  renders a smooth synthetic cursor and click ripples (Screen Studio style,
  matching `media/film`'s "a hand, not a dart" cursor). Alternatives:
  - burn a DOM cursor overlay into the page (crude, alters the app);
  - ship no cursor in v1.

  **Needs a decision.** The sidecar is recommended, possibly as phase 2.
- **Microphone narration:** an offscreen document cannot show a permission
  prompt. Mic needs a one-time grant from a visible extension page (an
  `options.html` tab calling `getUserMedia({ audio })`). Defer to v2. v1 is tab
  audio only, default off.
- **Permission change on self-update:** the new `tabCapture`, `offscreen`,
  `scripting` and `storage` permissions, plus a service worker. For an unpacked
  extension, Chrome grants them on reload without the disable-and-re-approve
  flow of store extensions. **Verify** that the self-update path
  (`chrome.runtime.reload()` from `shell-update.tsx`) picks them up, and that no
  "re-enable" banner appears. Popups running an older shell hide Record through
  the `record` capability.
- **Shell growth vs "the shell rarely changes":** the recorder must be
  extension code (tabCapture, offscreen). Keep it a thin state machine over
  `core/recorder.ts` schemas. Everything visible stays in the page.
- **Length / disk:** about 6–7 GB/h at 1440p30 / 14 Mbps. No in-memory
  accumulation (1 s chunks streamed), so length is bounded by disk only. Show a
  running size, and pick a max duration (e.g. 30 min) with a stated reason.
  MediaRecorder WebM has no cues or duration; the MP4 remux fixes seekability.
- **Codec support:** H.264 MediaRecorder on macOS Chrome is hardware-encoded.
  Verify `isTypeSupported` on the target Chrome. If only VP9 is available, the
  finalize step must re-encode to H.264 (slow at 1440p; consider keeping VP9
  WebM for the editor and only encoding on export).
- **activeTab scope:** a toolbar-command start (no popup) still grants
  activeTab. Recording a non-equin tab works too, but the cursor script needs the
  activeTab grant on that page (it has it).
- **Interrupted recordings:** if the browser crashes, the row stays `recording`.
  A boot hook (or a scheduled `defineJob`, no in-process timer) marks rows with
  no chunk for N minutes as `interrupted` and remuxes what arrived. Decide which.
- **Backup:** should `state/recordings` be in backups? GBs of video may blow
  backup targets. Probably opt-in.
- **DevTools emulation fallback** (`chrome.debugger` +
  `Emulation.setDeviceMetricsOverride`) gives any viewport regardless of screen
  size, but shows the "is debugging this browser" bar inside the capture. Not
  v1.

## Verification

- **Unit (`./equin test`):**
  - `core/viewport.ts`: deltas, maximized → normal, does-not-fit, zoom ≠ 1.
  - `core/recorder.ts` schemas round-trip.
  - recordings machine handlers: chunk ordering (409 on gap, idempotent replay),
    finish → job enqueued, Range responses.
  - finalize against a small fixture WebM/MP4 (ffprobe dimensions and duration).
- **Checks:** `./equin check` (boundaries: the recorder imports only
  `media/recordings/core`; endpoints are writes; collection bounded).
- **End to end (manual, needs a real click for tabCapture):**
  1. `./equin build`, then load `~/.equin/worktrees/<wt>/browser-extension/shell`
     unpacked (beside or instead of main's).
  2. Open the worktree's `http://<wt>.localhost:9000` tab, open the popup,
     choose Landscape, Start.
  3. The window snaps so the viewport is 1280×720 (check with DevTools). The
     badge shows `REC`.
  4. Interact for about 15 s, then press Alt+Shift+R. The window restores.
  5. The row goes `processing` → `ready`, and `query_db` shows it.
  6. `ffprobe ~/.equin/state/recordings/<id>.mp4` reports 2560×1440, H.264,
     about 15 s, `moov` atom at the start.
  7. Opening it in the panel plays and seeks.
  8. Repeat with Shorts on a large display, and confirm it is refused with a
     reason on a 14" laptop.
  9. Kill the server mid-recording and confirm `ERR`, a stopped recording, and
     a recoverable raw file.
- **Automatable part:** extend `e2e/popup-probe.ts` (Chromium with the shell
  loaded) to assert that the Record section renders, `hostInfo` reports
  `record`, and the relay route accepts a port and uploads a synthetic chunk
  sequence (a canvas `captureStream` fed into the offscreen relay path).
  tabCapture itself needs the real user invocation.
