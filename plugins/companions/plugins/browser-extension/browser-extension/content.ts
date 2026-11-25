/**
 * The recorder's content script, injected into the recorded tab by the
 * worker (`scripting.executeScript`, under the `activeTab` grant):
 *
 * - **Countdown** — 3-2-1 over the page (click to skip), answered once it is
 *   off the screen, so it is drawn before the capture starts and never in the
 *   video.
 * - **Pointer** — tab capture holds no OS cursor, so the pointer is drawn into
 *   the page (an arrow following `pointermove`, a ripple on each
 *   `pointerdown`) in the top layer, above the page's own dialogs, and every
 *   sample is kept for `<name>.pointer.json`. Removed on finish.
 *
 * Everything it draws lives in one shadow root, so the page's styles never
 * reach it and its own never leak.
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
const POINTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 2v17l4.5-4.2 3 6.6 3-1.3-3-6.4H18z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

const STYLE = `
:host { all: initial; }
.layer { position: fixed; inset: 0; pointer-events: none; overflow: hidden; }
.countdown { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(0,0,0,.35); cursor: pointer; pointer-events: auto; }
.countdown span { width: 120px; height: 120px; border-radius: 50%; display: grid; place-items: center; background: rgba(20,20,24,.7);
  color: #fff; font: 700 56px/1 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; backdrop-filter: blur(10px);
  box-shadow: 0 0 0 1px rgba(255,255,255,.12); animation: tick 1s ease-out; }
@keyframes tick { from { transform: scale(1.25); opacity: 0; } 30% { transform: scale(1); opacity: 1; } }
.ptr { position: absolute; left: 0; top: 0; width: 22px; height: 22px; margin: -2px 0 0 -2px; filter: drop-shadow(0 1px 2px rgba(0,0,0,.35)); will-change: transform; }
.ptr svg { display: block; width: 22px; height: 22px; }
.ptr[hidden] { display: none; }
.ripple { position: absolute; width: 36px; height: 36px; margin: -18px 0 0 -18px; border-radius: 50%;
  background: color-mix(in srgb, ${ACCENT} 35%, transparent); animation: ripple .5s ease-out forwards; }
@keyframes ripple { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }
`;

interface Overlay {
  host: HTMLElement;
  root: ShadowRoot;
  layer: HTMLElement;
}

/** The top-layer host: a manual popover nothing can click. */
function openOverlay(): Overlay {
  const host = document.createElement("equin-recorder");
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
  return { host, root, layer };
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

// ── Pointer ─────────────────────────────────────────────────────────────────

interface PointerSession {
  overlay: Overlay;
  arrow: HTMLElement;
  samples: PointerSample[];
  /** performance.now() at the start, and the time paused since. */
  startedAt: number;
  pausedMs: number;
  pausedAt: number | null;
  viewport: { width: number; height: number };
  stop: () => void;
}

let pointer: PointerSession | null = null;

function recordedNow(p: PointerSession): number {
  return Math.round(
    (p.pausedAt ?? performance.now()) - p.startedAt - p.pausedMs,
  );
}

function startPointer(): void {
  if (pointer !== null) return;
  const overlay = openOverlay();
  const arrow = document.createElement("div");
  arrow.className = "ptr";
  arrow.hidden = true;
  arrow.innerHTML = POINTER_SVG;
  overlay.layer.append(arrow);
  const p: PointerSession = {
    overlay,
    arrow,
    samples: [],
    startedAt: performance.now(),
    pausedMs: 0,
    pausedAt: null,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    stop: () => {},
  };
  const sample = (e: PointerEvent, kind: PointerSample[3]) => {
    if (p.pausedAt === null)
      p.samples.push([
        recordedNow(p),
        Math.round(e.clientX),
        Math.round(e.clientY),
        kind,
      ]);
  };
  const move = (e: PointerEvent) => {
    arrow.hidden = false;
    arrow.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    sample(e, "move");
  };
  const down = (e: PointerEvent) => {
    move(e);
    sample(e, "down");
    const ripple = document.createElement("span");
    ripple.className = "ripple";
    ripple.style.left = `${e.clientX}px`;
    ripple.style.top = `${e.clientY}px`;
    ripple.addEventListener("animationend", () => ripple.remove(), {
      once: true,
    });
    overlay.layer.append(ripple);
    // A click may open a dialog over the overlay: put it back on top.
    requestAnimationFrame(() => raise(overlay));
  };
  const up = (e: PointerEvent) => sample(e, "up");
  const leave = (e: MouseEvent) => {
    if (e.relatedTarget !== null) return;
    arrow.hidden = true;
    if (p.pausedAt === null)
      p.samples.push([
        recordedNow(p),
        Math.round(e.clientX),
        Math.round(e.clientY),
        "leave",
      ]);
  };
  const toggled = () => requestAnimationFrame(() => raise(overlay));
  const opts = { capture: true, passive: true } as const;
  window.addEventListener("pointermove", move, opts);
  window.addEventListener("pointerdown", down, opts);
  window.addEventListener("pointerup", up, opts);
  document.addEventListener("mouseout", leave, opts);
  document.addEventListener("toggle", toggled, opts);
  p.stop = () => {
    window.removeEventListener("pointermove", move, opts);
    window.removeEventListener("pointerdown", down, opts);
    window.removeEventListener("pointerup", up, opts);
    document.removeEventListener("mouseout", leave, opts);
    document.removeEventListener("toggle", toggled, opts);
    overlay.host.remove();
  };
  pointer = p;
}

function finish(): PointerTrack | null {
  const p = pointer;
  pointer = null;
  if (p === null) return null;
  p.stop();
  return { version: 1, viewport: p.viewport, samples: p.samples };
}

async function handle(cmd: ContentCommand): Promise<unknown> {
  switch (cmd.type) {
    case "content.countdown":
      await countdown();
      return null;
    case "content.pointer-start":
      startPointer();
      return null;
    case "content.pointer-pause":
      if (pointer !== null && pointer.pausedAt === null)
        pointer.pausedAt = performance.now();
      return null;
    case "content.pointer-resume":
      if (pointer !== null && pointer.pausedAt !== null) {
        pointer.pausedMs += performance.now() - pointer.pausedAt;
        pointer.pausedAt = null;
      }
      return null;
    case "content.finish":
      return finish();
  }
}

// Injected once per recording, into the extension's one isolated world per
// page: the listener a previous injection left (the last recording's, or
// another build's) is replaced, so the page answers with ONE listener — this
// build's, which refuses a command from another build in words rather than
// parse it against a contract that may have changed.
type Listener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];
const installed = globalThis as { __equinRecorderListener?: Listener };
if (installed.__equinRecorderListener !== undefined)
  chrome.runtime.onMessage.removeListener(installed.__equinRecorderListener);
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
installed.__equinRecorderListener = listener;
chrome.runtime.onMessage.addListener(listener);
