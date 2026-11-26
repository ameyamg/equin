# companions/browser-extension

equin in Chrome's toolbar. A companion (see `../../CLAUDE.md`): a thin shell
that frames an equin route and adds a bridge.

## Two halves

- **The shell** (`browser-extension/`, a leaf folder kind): `manifest.json`
  (MV3, no `key` — the build writes it from core), `popup.html` and
  `popup.ts`. The popup frames `<origin>/home/browser-extension?embed=1` and
  serves the page's bridge calls with `chrome.tabs`, `chrome.action`,
  `window.close` and `chrome.runtime.reload`. It never calls equin: the
  iframe's own requests are same-origin, so the gateway reads them as the
  owner. The recorder adds a service worker, an offscreen document, a content
  script and a permissions page (below).
- **The page** (`web/`): the `browser-extension` app, whose layout is
  `CompanionPanel` over `BrowserExtension.Section` (header, Wish, page
  actions, footer — `config/companions/browser-extension/section.jsonc`).

## The bridge (`core/bridge.ts`)

The page says hello to its parent (posted to the extension origin only); the
shell answers a hello from its own iframe, at the equin origin it framed, with
a fresh `MessagePort` — so a page whose modules load late still gets the port.
The page accepts a port only from `chrome-extension://<EXTENSION_ID>`
(`acceptBridgePort`). `EXTENSION_ID` is derived from `EXTENSION_PUBLIC_KEY`
(core), and the build writes that key into the manifest, so the id Chrome
gives the extension and the one the page trusts cannot drift. Never change
the key.

The gateway also refuses to let anything else frame the page: the machine
half contributes `DocumentHead.FrameAncestors` for the app's base path, so
the shell is served under `frame-ancestors chrome-extension://<EXTENSION_ID>`
(defence in depth on top of the port check; a plain tab is unaffected).

`useExtensionHost()` is pending / absent / present like the menu bar's
`useNativeHost()`. Absent (a plain tab, or framed by anything else): the route
says it runs inside the extension.

## The popup trace

Chrome closes a popup on its own (focus loss, an extension reload) and the
page inside dies before it can log why. So the shell traces each popup's
lifecycle (`browser-extension/popup-trace.ts`: open, frame load, hello,
heights, focus / blur with `hasFocus`, visibility, pagehide, errors, close
and reload calls) into the extension origin's own `localStorage`,
synchronously, and the next popup hands it to the page (`lastPopupTrace`,
capability `trace`), which logs one line on the `browser-extension` channel
(`web/internal/shell-update.tsx`). A popup that closed on open is explained
by the line the next open writes. `e2e/popup-probe.ts` asserts the round trip.

## The tab recorder

Record the tab the popup (or ⌥⇧R, the `toggle-recording` command) was opened
on, to an MP4 at a standard size. Plan:
`research/2026-11-15-companions-chrome-window-recorder-v2.md`. The shell's
half is a thin state machine over `core/recorder.ts` (every message parsed on
both ends) and `core/viewport.ts` (pure, tested); what the panel shows is
`plugins/recorder`.

- **`background.ts`** (service worker) owns the session — the popup closes as
  soon as the page is clicked. Its state lives in `chrome.storage.session`
  (`recorder-store.ts`; it survives the worker being stopped), and the popup
  pushes each change to the page as a `BridgeEvent` on the port of a page that
  called `recorder`. Start: measure the tab (`measure.ts`, a script in the
  page under `activeTab`), resize the window so the page is the preset's layout
  (720p 1280 × 720, 1080p 1920 × 1080, 1440p 2560 × 1440, 9:16 540 × 960;
  As is keeps it — a size too big for the screen is refused), the old bounds kept
  to put back; count down in the page; take a `tabCapture` stream id; start the
  offscreen recorder; badge REC. Stop / Discard / Pause / a manual resize (it
  stops: one size per video) / the tab closing. Every stop carries its
  `StopCause` (`core/recorder.ts`): the saved state keeps it, so the panel
  says when a recording stopped on its own, and a stop before the first chunk
  is a failure naming the cause, never a finish of nothing. The resize rule
  reads the window's size when its step runs, never the event's snapshot: the
  start's own un-maximize and resize queue events behind it.
  `plugins/recorder/e2e/session-probe.ts --headed` runs the whole session
  (resize, countdown, real `tabCapture`, upload) from a maximized window.
- **`offscreen.ts`** (reason USER_MEDIA) records the stream at every
  physical pixel of the page — layout × DPR, `outputFor` (asserted from the
  track's settings), tab audio
  and the mic mixed into one track, H.264/AAC MP4 in 1 s chunks (no fallback
  codec). It uploads through the **relay page**: it frames
  `RECORDER_RELAY_PATH` (the recorder plugin's unlisted app) with the same
  hello → port handshake as the popup, so the uploads are the owner's, chunk by
  chunk in order, at most 64 MB queued. A request equin did not answer (a
  backend switch on redeploy, the relay page reloading) is sent again
  (`sendUntilAnswered`); a finish waits until equin's save job has saved the
  video (see `plugins/recorder/CLAUDE.md`).
- **`content.ts`** draws the countdown (before the capture) and, with the
  Clicks option, a ripple on each click into the page's top layer, in a
  closed shadow root; it always keeps the pointer samples for
  `<name>.pointer.json`. It never draws a pointer: Chrome's tab capture
  composites the OS cursor itself (while the mouse moves over the tab,
  hidden after 2 s still), with no way for an extension to turn it off — a
  drawn arrow was a second cursor. Injected again into the same page (each
  recording, each `complete` of the tab), the new script takes the previous
  one's session over, so one script draws.
  `plugins/recorder/e2e/cursor-probe.ts --headed` reads the frames.
- **`permissions.html`** asks for the microphone once (an offscreen document
  cannot prompt); Chrome keeps the grant for the extension's origin.

## Page actions

`BrowserExtension.PageAction` is an action an app offers on the pages its
`site` matches (`core/page-actions.ts`). The section groups the matching ones
by `site.label`, one `PanelSection` each, in slot order, ⌘1…⌘9 in row order.
An action is a `link` (it declares its `href`; the panel subtitles the row with
the destination on one truncated line, full URL in the tooltip, and owns the
gestures: click → the current tab, ⌘/Ctrl- or middle-click → a background tab,
like a link) or a `run` (its own subtitle and `run`).
A contributor that must not carry the extension into its own composition
contributes from a leaf here (`plugins/equin-site`: its address model reads an
equin page as instance — worktree / main / equin.ai — × view — app / demo /
site page; each row moves one axis, so a page offers at most three rows, a
diagonal being two hops, over the website's own mappings in
`apps/website/shell` and `live-demo`).

## Shipping and self-update

`./equin build` runs `writeExtensionShell` (`cli/`) — each script bundled on
its own (`popup`, `background`, `offscreen`, `permissions` as modules, the
content script as an IIFE) and the equin origin written into `popup.html` and
`offscreen.html` — for the checkout's own
namespace, as this plugin's `deployed` build step (`build-step/`): main's into `~/.equin/state/browser-extension/` (the installed
one), a worktree's into `~/.equin/worktrees/<wt>/browser-extension/`. The root
holds `shell/` (swapped whole by rename), `shell-digest.txt` (written last)
and `connection.json`. Nothing is written when the digest is unchanged.

**One shell, one build.** Chrome loads the shell's parts at different times:
the manifest and the service worker only when the extension (re)loads, the
popup, the offscreen document and the content script from disk on each open.
So after a build, parts of two builds can run side by side. The build stamps
the shell with its digest (`cli/internal/stamp-shell.ts`): the manifest's
`version_name` and every script's `SHELL_BUILD` (`chrome-api.ts`), so a change
to ANY part is a new manifest. The popup compares its build with the loaded
manifest's (a stale load asks the page to reload the extension); every
message between parts goes through `sendToExtension` / `sendToTab`, which
stamp it (Chrome's raw `sendMessage` is not in the typed API), and a receiver
refuses another build's message in words before its schema reads it.
`errorText` never hands the panel zod's raw issue list.
`e2e/build-skew-probe.ts` loads one build and writes the next over it on disk.

The backend serves `browser-extension.shell` (the digest) from a watch on the
digest file, so the push reaches open popups without a poll; the panel asks
the shell to `reload()` when its own `shellDigest` differs (once per pair —
see `web/internal/shell-update.tsx`). Each open is recorded
(`browser-extension.connection`) for the Settings → Accounts row
(`plugins/accounts-row`).

Install once: `chrome://extensions` → Developer mode → Load unpacked →
`~/.equin/state/browser-extension/shell`.

<!-- AUTOGENERATED:BEGIN — do not edit; regenerated by `./equin build` -->

## Plugin reference

- Description: The browser extension's panel: the browser-extension app (unlisted, colorMode system, in the companions' `companion` theme) mounted at /home/browser-extension, whose whole layout is the companions' panel over the BrowserExtension.Section slot (chromeless under ?embed=1) — the companions' header, the page actions, and the footer (opening equin in a new tab). useExtensionHost() reads the popup's bridge (a MessagePort accepted only from the extension's own origin): pending, absent (a plain tab — the route then says it runs inside the extension), or present with the shell's info, the tab the popup is about and its methods. BrowserExtension.PageAction is an action an app offers on the pages its site matches; the page-actions section groups the matching ones by site (one labelled section each), each a gradient tile, title and subtitle with its ⌘N, a spinner while it runs, then a check. The panel reports its height to the popup, records each open, and reloads the extension when the served shell's digest differs from its own.
- Web:
  - Slots:
    - `BrowserExtension.Section`
    - `BrowserExtension.PageAction`
  - Slot contributors:
    - `BrowserExtension.Section` ← `companions.browser-extension`
    - `BrowserExtension.Section` ← `companions.browser-extension.recorder`
    - `BrowserExtension.Section` ← `companions.browser-extension.wish`
    - `BrowserExtension.PageAction` ← `companions.browser-extension.equin-site`
  - Contributes:
    - `Apps.App` "Browser extension" → `BrowserExtensionPanel`
    - `BrowserExtension.Section` "Header" → `CompanionHeader`
    - `BrowserExtension.Section` "Page actions" → `PageActionsSection`
    - `BrowserExtension.Section` "Footer" → `ExtensionFooter`
  - Uses: 28 symbols — full list in [REFERENCE.md](./REFERENCE.md)
    - `companions/panel` ×5
    - `primitives/slot-render` ×3
    - `apps-core.Apps`
    - `infra/endpoints.useFetchEndpoint`
    - `network/live/live-state.foldResource`
    - `network/live.useLive`
    - `primitives/css/center.Center`
    - `primitives/css/line.Line`
    - `primitives/css/row.Row`
    - `primitives/css/spacing.Stack`
    - `primitives/css/spinner.Spinner`
    - `primitives/css/surface.Surface`
    - `primitives/css/text.Text`
    - `primitives/css/yield.yieldClass`
    - `primitives/dom/web-storage.defineStore`
    - `primitives/latest-ref.useLatestRef`
    - `primitives/link-gesture.linkGestureProps`
    - `primitives/loading.Loading`
    - `primitives/log-channels.clientLog`
    - `primitives/shortcuts.usePageShortcuts`
    - `ui/icons.Icon`
    - `ui/logo.Logo`
  - Exports (types):
    - `ExtensionHost`
    - `ExtensionRecorder`
  - Exports (values):
    - `BrowserExtension`
    - `useExtensionHost`
- Server:
  - Contributes:
    - `resource.declare` "browser-extension.connection"
    - `resource.declare` "browser-extension.shell"
    - `DocumentHead.FrameAncestors` "browser-extension (/home/browser-extension)"
  - Resources:
    - `browser-extension.connection` (push, notified)
    - `browser-extension.shell` (push, notified)
- Machine:
  - Uses:
    - `infra/endpoints.implementMachine`
    - `network/live.serveValue`
  - Register: `defineFileWatcher('companions.browser-extension')`
  - Routes: `POST /api/browser-extension/connection`
- Core:
  - Uses:
    - `infra/endpoints.defineEndpoint`
    - `network/live.liveValue`
    - `packages/string-hash.createSha256`
    - `primitives/pane.defineApp`
    - `ui/icons.symbol`
  - Exports (types):
    - `ActiveTab`
    - `BridgeCall`
    - `BridgeEvent`
    - `BridgeMethod`
    - `BridgePortMessage`
    - `BridgeRequest`
    - `BridgeResponse`
    - `BridgeResult`
    - `ConnectionState`
    - `ExtensionCapabilities`
    - `ExtensionHostInfo`
    - `LastRecording`
    - `MicPermission`
    - `PageAction`
    - `PageActionGroup`
    - `PageActionHost`
    - `PageActionSite`
    - `PageLinkAction`
    - `PageRunAction`
    - `PointerSample`
    - `PointerTrack`
    - `PopupTrace`
    - `PopupTraceEvent`
    - `RecorderCommand`
    - `RecorderOptions`
    - `RecorderSnapshot`
    - `RecorderState`
    - `RecordPreset`
    - `RecordPresetId`
    - `RelayFinished`
    - `RelayRequest`
    - `RelayResponse`
    - `SavedRecording`
    - `ShellState`
    - `SizeRefusal`
    - `SizeResult`
    - `StopCause`
    - `TabFit`
    - `TabMeasure`
    - `WindowBounds`
  - Exports (values):
    - `acceptBridgePort`
    - `ActiveTabSchema`
    - `BRIDGE_HELLO`
    - `BRIDGE_PORT`
    - `BRIDGE_RESULTS`
    - `BridgeCallSchema`
    - `BridgeEventSchema`
    - `BridgeHelloSchema`
    - `BridgeRequestSchema`
    - `BridgeResponseSchema`
    - `browserExtensionApp`
    - `browserExtensionConnection`
    - `browserExtensionShell`
    - `ConnectionStateSchema`
    - `DEFAULT_RECORDER_OPTIONS`
    - `EXTENSION_ID`
    - `EXTENSION_ORIGIN`
    - `EXTENSION_PUBLIC_KEY`
    - `ExtensionCapabilitiesSchema`
    - `ExtensionHostInfoSchema`
    - `extensionIdFromKey`
    - `groupPageActions`
    - `LastRecordingSchema`
    - `MicPermissionSchema`
    - `outputFor`
    - `PointerTrackSchema`
    - `POPUP_TRACE_MAX_EVENTS`
    - `PopupTraceSchema`
    - `presetFit`
    - `presetSizeText`
    - `RECORD_PRESETS`
    - `recordedMs`
    - `RECORDER_RELAY_PATH`
    - `RecorderCommandSchema`
    - `RecorderOptionsSchema`
    - `RecorderSnapshotSchema`
    - `RecorderStateSchema`
    - `recordExtensionOpen`
    - `recordPreset`
    - `RelayCreatedSchema`
    - `RelayFinishedSchema`
    - `RelayRequestSchema`
    - `RelayResponseSchema`
    - `SavedRecordingSchema`
    - `ShellStateSchema`
    - `sizeRefusalText`
    - `StopCauseSchema`
    - `stopCauseText`
    - `TabFitSchema`
    - `windowBoundsFor`
- Cross-plugin:
  - Uses tokens:
    - `ui/tokens/color-palette --destructive`
    - `ui/tokens/color-palette --success`
    - `ui/tokens/shape --spacing`
    - `ui/tokens/type-scale --font-weight-semibold`
  - Imported by:
    - `companions/browser-extension/accounts-row`
    - `companions/browser-extension/equin-site`
    - `companions/browser-extension/recorder`
    - `companions/browser-extension/wish`
- Exemptions:
  - Exempts itself from:
    - `frame/no-raw-frame` — `browser-extension/popup.ts` (sanctioned)
    - `frame/no-raw-frame` — `browser-extension/offscreen.ts` (sanctioned)
    - `audio-context/no-raw-audio-context` — `browser-extension/offscreen.ts` (sanctioned)
    - `media-element/no-raw-media-play` — `browser-extension/offscreen.ts` (sanctioned)
    - `web-storage/no-raw-web-storage` — `browser-extension/popup-trace.ts` (sanctioned)
- Cli:
  - Exports (types): `ShellWrite`
  - Exports (values): `writeExtensionShell`
- Sub-plugins:
  - **`accounts-row`** — The browser extension's row in Settings → Accounts (Auth.Integration, service equin): not built / not connected / connected · up to date / update pending — read live from the served shell's digest…
  - **`equin-site`** — The equin site's page actions in the browser extension, over one address model (core: parseEquinAddress / formatEquinAddress) that reads any equin page as an instance (a worktree, main, equin.ai) ×…
  - **`recorder`** — The browser extension's tab recorder, in the panel: the Record section (BrowserExtension.Section 'record', after Wish) — the 'Record this tab' row with the size dropdown (each preset named by the…
  - **`wish`** — The browser extension's Wish section (BrowserExtension.Section 'wish'): wish's WishField under a 'Wish' title — the task composer with its own ↑, filing one task under Wishes and confirming inline…

<!-- AUTOGENERATED:END -->
