# Chrome tab recorder — v2: the browser extension only

Status: plan. Supersedes the scope of
[v1](./2026-11-15-companions-chrome-window-recorder.md); the mechanics v1 worked
out (service worker + offscreen document, the upload relay through an equin
page, window measuring) are kept and referenced, not repeated.

Prototype: `proto-1794537939-tuvpg1` (the extension popover's Record section).

## Context

The user wants to record the current Chrome tab and share the video. v1 planned
a recordings store (DB table, live collection) feeding a future video editor app.
The user narrowed the scope: **only the browser extension**. A recording is a
plain video file in a folder the user chooses; anything that edits or lists
recordings later (the editor, `proto-1794748471-60n3gb`) reads that folder.

Requirements from review:

- **The output is a standard video size**, whatever the screen: 720p, 1080p or
  1440p (16:9), or 9:16 for Shorts — plus an **As is** escape hatch.
- **The pointer is in the video** (with click feedback), and the **microphone**
  can be recorded.
- **Countdown is a toggle** (3-2-1 before capture, on by default).
- **After a recording**, the popover shows it with two hover actions — **Show in
  Files** (the equin file explorer) and **Delete** — instead of "Open in Studio".

## Approach

### Size: a fixed layout, scaled to a standard output

Two sizes, decided separately:

- **Layout (CSS) size — always 1280 × 720.** The window is resized so the tab's
  viewport is exactly 1280 × 720 CSS px (v1 § Recording flow, steps 2–3:
  measure `outer − inner`, `chrome.windows.update`, wait for `onBoundsChanged`,
  re-measure, correct once, fail loudly). It fits every laptop screen, and the
  page lays out the same in every recording.
- **Output size — the preset: 720p, 1080p (default) or 1440p.** tabCapture
  scales its frames to the size the recorder asks for: the offscreen
  `getUserMedia` constraints set `minWidth = maxWidth = 1920`,
  `minHeight = maxHeight = 1080` (for 1080p). Because the viewport is exactly
  16:9, there is no letterboxing. The recorder asserts
  `track.getSettings()` is the preset's size before recording (fail loudly).

On Retina (DPR 2) the viewport renders at 2560 × 1440 physical, so 720p, 1080p
and 1440p are all downscales and sharp. On a DPR-1 display, 1080p and 1440p
would be upscales: its dropdown entry is disabled, with the reason.

The presets, as one closed list in `core/`:

| Preset | Page (CSS) | Video |
|---|---|---|
| 720p / 1080p (default) / 1440p | 1280 × 720 | 1280×720 / 1920×1080 / 2560×1440 |
| 9:16 | 540 × 960 | 1080 × 1920 |
| As is | no resize | the page's own physical size (not standard, by choice) |

**9:16 is greyed out when it does not fit**: 960 CSS px plus Chrome's toolbars
exceeds a 14" MacBook's 982 pt screen; the entry reads "Doesn't fit this screen".

`core/viewport.ts` (pure, tested) keeps v1's `windowBoundsFor(page, measured)`
and gains `outputFor(preset, dpr)`. Both answer a discriminated result —
`{ ok: false, reason: "does-not-fit" | "zoomed" | "upscale" }` — and the panel
disables that dropdown entry with the reason.

### When it happens

1. **Record** (panel row, or ⌥⇧R): the worker takes the session; the popup may close.
2. **Measure**, then **resize** to the 1280 × 720 layout (old bounds saved to
   `chrome.storage.session`).
3. **Countdown**, if on: 3-2-1 drawn by a content script over the page
   (click to skip). It is drawn *before* capture starts, so it is never in
   the video.
4. **Capture** at the preset's output size; `MediaRecorder` in 1 s chunks,
   `video/mp4;codecs=avc1,mp4a` (Chrome ≥ 126; fail loudly when unsupported —
   no silent WebM fallback, since the point is a shareable standard file).
5. **Stop** (panel, ⌥⇧R, tab closed): last chunk flushed, window restored,
   badge cleared, the saved recording shown in the panel.

A manual resize mid-recording stops it with reason `resized` (v1).

### Where the file goes: a folder setting

- A config_v2 setting **Recordings folder** (`companions.browser-extension.recorder`,
  default `~/Movies/equin`), in Settings → Config; the popover's ⚙ links to it.
  File name: `<YYYY-MM-DD HH.MM> <tab title>.mp4` (sanitized, de-duplicated with
  ` (2)`).
- Bytes reach the machine through v1's **upload relay**: the offscreen document
  frames the hidden equin route `/home/browser-extension/recorder`, which posts
  each chunk same-origin, as the owner (a fetch from the extension origin is
  anonymous to the gateway). Machine endpoints (`implementMachine`, pattern of
  `plugins/screenshot/machine/internal/handle-save-file.ts`):
  - `POST /api/tab-recordings` → creates `<folder>/.<name>.partial.mp4`, answers `{ id, path }`;
  - `POST /api/tab-recordings/:id/chunks/:seq` → appends; `seq` must be the
    next one (409 otherwise, never reorder);
  - `POST /api/tab-recordings/:id/finish` → `fsync`, remux to a faststart MP4
    with `media/ffmpeg` (`-c copy -movflags +faststart`, seconds), then
    `link()` to the final name (never overwrites). Answers the final path,
    duration and size.
- **No DB table, no live collection.** The panel shows the recording the
  worker just finished (kept in `chrome.storage.session`, so it survives the
  popup closing). Listing older recordings is the folder's job (Files, the
  future editor).

### After a recording: Show in Files, Delete

The saved row (thumbnail, duration, size, file name) has two hover actions,
drawn like the popover's other row actions:

- **Show in Files** — opens the equin file explorer on the file:
  `/files/browse/<folder>/preview/<name>.mp4` (the explorer's own route
  grammar, `apps/file-explorer/plugins/browser`), in a new tab.
- **Delete** — moves the file to the Trash through the explorer's existing
  file operation (its "Move to Trash" row action's endpoint), never a new
  delete route. The row leaves; the Trash is the undo.

## Plugins & files

- **New `plugins/companions/plugins/browser-extension/plugins/recorder`**
  - `web/`: the Record section (`BrowserExtension.Section`, after Wish) —
    a size dropdown (720p / 1080p / 1440p / 9:16 / As is, each with its video
    size; one that does not fit is disabled with the reason), toggles (tab
    audio, mic, pointer, countdown), a red round **Record** icon button (tooltip "Record ⌥⇧R") —
    the row itself is not clickable —, the
    row with ⌥⇧R, the live recording card (timer, Pause, Stop, Discard), the
    saved row with its two hover actions; the relay route.
  - `core/`: the config (`folder`, `output`, `countdown`, `tabAudio`), the
    endpoints above, `outputFor`.
  - `machine/`: the three handlers; ffmpeg via `ensureDep`.
- **Modified `plugins/companions/plugins/browser-extension`**: as v1 § Modified
  (manifest permissions `tabCapture`, `offscreen`, `scripting`, `storage`; the
  `toggle-recording` command; `background.ts`; `offscreen.html/ts`; the bridge's
  `record` capability; `core/viewport.ts`; `write-shell.ts` bundles three
  entrypoints), plus the content script (countdown and pointer) and
  `permissions.html` (the one-time mic grant).
- **Dropped from v1**: `plugins/media/plugins/recordings` (table, live
  collection, finalize job, Range file route), the
  "interrupted recordings" sweep (a `.partial` file left behind is visible in
  the folder and remuxable by hand).

### The pointer, drawn into the page

> **Superseded 2026-11-25.** The premise below was wrong: Chrome's tab capture
> composites the real OS cursor into the frames (Chromium's
> `mouse_cursor_overlay_controller`: always on, shown once the mouse moves over
> the tab, hidden after 2 s still; no constraint turns it off). The drawn arrow
> was a second cursor in every real video, and the probes never saw it because
> Playwright's input never moves the OS cursor. The recorder no longer draws a
> pointer: the option is **Clicks** (ripples), and the pointer track is always
> kept for `<name>.pointer.json`. See `content.ts`.

tabCapture never contains the OS cursor. With **Pointer** on (default), the
recorder's content script (the same one that draws the countdown) draws a
pointer element that follows `pointermove`, plus a ripple on each
`pointerdown`, into the page's **top layer** (a `popover="manual"` element with
`pointer-events: none`), so it sits above every dialog and is captured with
the page. The real cursor stays on top of it for the user; the video shows only
the drawn one. Removed on stop. The same samples are also written beside the
video as `<name>.pointer.json`, so a later editor can redraw a smoother pointer
or zoom on clicks without re-recording.

Limits: it follows the
pointer only inside the recorded tab (leaving the page hides it), and the
cursor's shape is always the arrow (no text I-beam or hand).

### Microphone

The offscreen document cannot show a permission prompt. The first time **Mic**
is turned on, the extension opens its own small page (`permissions.html`) that
calls `getUserMedia({ audio: true })` once; Chrome remembers the grant for the
extension's origin. The offscreen recorder then mixes the mic and the tab audio
(Web Audio) into the one audio track.

## Open questions
- **Max length**: ~2.5 GB/h at 1080p30 (6 Mbps). No in-memory buffering, so
  disk-bound; confirm whether a cap is wanted.

## Verification

- `./equin test`: `core/viewport.ts` (bounds from deltas, maximized → normal,
  zoom ≠ 1 refused, 9:16 does-not-fit, `outputFor` upscale refusal), chunk ordering in the machine
  handlers (409 on a gap, replay of the last seq is a no-op), file naming.
- Manual (tabCapture needs a real click): record 10 s at each preset; `ffprobe`
  shows 1280×720 / 1920×1080 / 2560×1440 / 1080×1920 H.264 + AAC, `faststart`;
  the drawn pointer and click ripples are in the video and gone from the page
  after stop; with Mic on, the narration is in the audio track; the window
  is back to its old bounds; the countdown is absent from the video; Show in
  Files opens the file's preview; Delete puts it in the Trash.
