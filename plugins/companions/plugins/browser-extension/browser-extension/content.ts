/**
 * The recorder's content script, injected into the recorded tab by the
 * worker (`scripting.executeScript`, under the `activeTab` grant):
 *
 * - **Countdown** — 3-2-1 over the page (click to skip), answered once it is
 *   off the screen, so it is drawn before the capture starts and never in the
 *   video.
 * - **Pointer track** — every pointer sample, kept for `<name>.pointer.json`
 *   (for an editor). Nothing of the pointer is drawn: Chrome's tab capture
 *   composites the OS cursor itself (always, while the mouse moves over the
 *   tab; hidden after 2 s still — Chromium's mouse_cursor_overlay_controller),
 *   so an arrow drawn here is a second cursor in the video.
 * - **Clicks** (the option) — a ripple on each `pointerdown`, in the top
 *   layer, above the page's own dialogs. Removed when its animation finishes
 *   OR is cancelled, so no click can leave a mark behind.
 *
 * Everything it draws lives in one shadow root, so the page's styles never
 * reach it and its own never leak.
 *
 * **Injected again into the same page** (each recording, and on every
 * `complete` of the tab — an in-page navigation keeps the extension's
 * isolated world, and the scripts in it): the new injection takes the
 * previous one's session over (`dispose` hands it on) — never two scripts
 * listening and drawing, one of them orphaned and deaf to `finish`, as
 * before 2026-11-25.
 */
import {
  ContentCommandSchema,
  type ContentCommand,
  type PointerSample,
  type PointerTrack,
} from "../core/recorder";
import {
  chrome,
  errorText,
  messageBuild,
  messageType,
  OTHER_BUILD_TEXT,
  SHELL_BUILD,
  unstamped,
} from "./chrome-api";

const ACCENT = "#e8643c";
const HOST_TAG = "equin-recorder";
const RIPPLE_MS = 500;

const STYLE = `
:host { all: initial; }
.layer { position: fixed; inset: 0; pointer-events: none; overflow: hidden; }
.countdown { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(0,0,0,.35); cursor: pointer; pointer-events: auto; }
.countdown span { width: 120px; height: 120px; border-radius: 50%; display: grid; place-items: center; background: rgba(20,20,24,.7);
  color: #fff; font: 700 56px/1 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; backdrop-filter: blur(10px);
  box-shadow: 0 0 0 1px rgba(255,255,255,.12); animation: tick 1s ease-out; }
@keyframes tick { from { transform: scale(1.25); opacity: 0; } 30% { transform: scale(1); opacity: 1; } }
.ripple { position: absolute; width: 36px; height: 36px; margin: -18px 0 0 -18px; border-radius: 50%; opacity: 0;
  background: color-mix(in srgb, ${ACCENT} 35%, transparent); }
`;

interface Overlay {
  host: HTMLElement;
  layer: HTMLElement;
}

/** The top-layer host: a manual popover nothing can click. */
function openOverlay(): Overlay {
  const host = document.createElement(HOST_TAG);
  host.setAttribute("popover", "manual");
  host.style.cssText =
    "all: initial; position: fixed; inset: 0; width: 100vw; height: 100vh; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; background: transparent; overflow: visible; pointer-events: none; z-index: 2147483647;";
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = STYLE;
  const layer = document.createElement("div");
  layer.className = "layer";
  root.append(style, layer);
  document.documentElement.append(host);
  host.showPopover();
  return { host, layer };
}

/** Put the overlay back on top of the top layer (a dialog opened since). */
function raise(o: Overlay): void {
  if (!o.host.isConnected) document.documentElement.append(o.host);
  if (o.host.matches(":popover-open")) o.host.hidePopover();
  o.host.showPopover();
}

const nextFrame = () =>
  new Promise((r) => requestAnimationFrame(() => r(null)));

// ── Countdown ───────────────────────────────────────────────────────────────

async function countdown(): Promise<void> {
  const o = openOverlay();
  const veil = document.createElement("div");
  veil.className = "countdown";
  veil.title = "Click to start now";
  o.layer.append(veil);
  await new Promise<void>((resolve) => {
    let n = 3;
    const show = () => {
      const digit = document.createElement("span");
      digit.textContent = String(n);
      veil.replaceChildren(digit);
    };
    const end = () => {
      clearInterval(timer);
      resolve();
    };
    show();
    const timer = setInterval(() => {
      n -= 1;
      if (n === 0) end();
      else show();
    }, 1000);
    veil.addEventListener("pointerdown", end, { once: true });
  });
  o.host.remove();
  // Two frames: the page the capture's first frame sees no longer has it.
  await nextFrame();
  await nextFrame();
}

// ── Pointer track and clicks ────────────────────────────────────────────────

/** A recording's session in this page: plain data, handed from one injection
 *  to the next. */
interface Track {
  clicks: boolean;
  samples: PointerSample[];
  /** performance.now() at the start, and the time paused since. */
  startedAt: number;
  pausedMs: number;
  pausedAt: number | null;
  viewport: { width: number; height: number };
}

/** The listeners (and the click overlay) a track runs with. */
interface Attached {
  track: Track;
  detach: () => void;
}

function recordedNow(t: Track): number {
  return Math.round(
    (t.pausedAt ?? performance.now()) - t.startedAt - t.pausedMs,
  );
}

function attach(track: Track): Attached {
  const overlay = track.clicks ? openOverlay() : null;
  const sample = (e: MouseEvent, kind: PointerSample[3]) => {
    if (track.pausedAt === null)
      track.samples.push([
        recordedNow(track),
        Math.round(e.clientX),
        Math.round(e.clientY),
        kind,
      ]);
  };
  const move = (e: PointerEvent) => sample(e, "move");
  const down = (e: PointerEvent) => {
    sample(e, "move");
    sample(e, "down");
    if (overlay === null) return;
    const ripple = document.createElement("span");
    ripple.className = "ripple";
    ripple.style.left = `${e.clientX}px`;
    ripple.style.top = `${e.clientY}px`;
    overlay.layer.append(ripple);
    // Web Animations, not a CSS animation: re-raising the overlay (a
    // hide + show) cancels CSS animations, and restarts them — a click
    // mark that never finished. This one ends on its timeline, and the
    // element goes either way.
    const animation = ripple.animate(
      [
        { transform: "scale(.3)", opacity: 1 },
        { transform: "scale(1.4)", opacity: 0 },
      ],
      { duration: RIPPLE_MS, easing: "ease-out", fill: "forwards" },
    );
    const remove = () => ripple.remove();
    animation.addEventListener("finish", remove, { once: true });
    animation.addEventListener("cancel", remove, { once: true });
  };
  const up = (e: PointerEvent) => sample(e, "up");
  const leave = (e: MouseEvent) => {
    if (e.relatedTarget === null) sample(e, "leave");
  };
  // Another top-layer element opened (a dialog, a popover): put the ripples
  // back above it. Never on a recorder overlay's own toggle — raising fires
  // one, and two overlays answering each other's never stop.
  const toggled = (e: Event) => {
    if (overlay === null) return;
    if (e.target instanceof Element && e.target.localName === HOST_TAG) return;
    if ((e as ToggleEvent).newState !== "open") return;
    requestAnimationFrame(() => raise(overlay));
  };
  const opts = { capture: true, passive: true } as const;
  window.addEventListener("pointermove", move, opts);
  window.addEventListener("pointerdown", down, opts);
  window.addEventListener("pointerup", up, opts);
  document.addEventListener("mouseout", leave, opts);
  document.addEventListener("toggle", toggled, opts);
  return {
    track,
    detach: () => {
      window.removeEventListener("pointermove", move, opts);
      window.removeEventListener("pointerdown", down, opts);
      window.removeEventListener("pointerup", up, opts);
      document.removeEventListener("mouseout", leave, opts);
      document.removeEventListener("toggle", toggled, opts);
      overlay?.host.remove();
    },
  };
}

let current: Attached | null = null;

function finish(): PointerTrack | null {
  const a = current;
  current = null;
  if (a === null) return null;
  a.detach();
  return { version: 1, viewport: a.track.viewport, samples: a.track.samples };
}

async function handle(cmd: ContentCommand): Promise<unknown> {
  switch (cmd.type) {
    case "content.countdown":
      await countdown();
      return null;
    case "content.track-start":
      // Already tracking: this page was injected again mid-recording.
      if (current === null)
        current = attach({
          clicks: cmd.clicks,
          samples: [],
          startedAt: performance.now(),
          pausedMs: 0,
          pausedAt: null,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        });
      return null;
    case "content.track-pause":
      if (current !== null && current.track.pausedAt === null)
        current.track.pausedAt = performance.now();
      return null;
    case "content.track-resume":
      if (current !== null && current.track.pausedAt !== null) {
        current.track.pausedMs += performance.now() - current.track.pausedAt;
        current.track.pausedAt = null;
      }
      return null;
    case "content.finish":
      return finish();
  }
}

// ── Installation ────────────────────────────────────────────────────────────

type Listener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];
const listener: Listener = (message, _sender, sendResponse) => {
  if (messageType(message)?.startsWith("content.") !== true) return undefined;
  // The worker reads `{ error }` as a failure, and says it.
  if (messageBuild(message) !== SHELL_BUILD) {
    sendResponse({ error: OTHER_BUILD_TEXT });
    return undefined;
  }
  handle(ContentCommandSchema.parse(unstamped(message))).then(
    sendResponse,
    (err: unknown) => sendResponse({ error: errorText(err) }),
  );
  return true;
};

/** What an injection leaves in the isolated world for the next one. */
interface Installed {
  /** Stop listening and drawing; answers the session, to carry on. */
  dispose: () => Track | null;
}
const world = globalThis as {
  __equinRecorder?: Installed;
  /** Before 2026-11-25 an injection left only its message listener. */
  __equinRecorderListener?: Listener;
};

const adopted = world.__equinRecorder?.dispose() ?? null;
if (world.__equinRecorderListener !== undefined) {
  chrome.runtime.onMessage.removeListener(world.__equinRecorderListener);
  delete world.__equinRecorderListener;
}
// An overlay still in the page belongs to an injection that can no longer
// be told to finish (a build before 2026-11-25 orphaned one on every
// re-injection, and it kept drawing a pointer and clicks into every later
// video). Its listeners live until the page reloads, and they put a removed
// overlay back on the next click — so it is hidden where it stands instead.
for (const stale of document.querySelectorAll<HTMLElement>(HOST_TAG)) {
  stale.style.setProperty("display", "none", "important");
  stale.dataset.equinStale = "";
}
if (adopted !== null) current = attach(adopted);

chrome.runtime.onMessage.addListener(listener);
world.__equinRecorder = {
  dispose: () => {
    chrome.runtime.onMessage.removeListener(listener);
    const a = current;
    current = null;
    if (a === null) return null;
    a.detach();
    return a.track;
  },
};
