/**
 * The popup's lifecycle trace (`core/bridge.ts`'s `PopupTrace`): what
 * happened to this popup from its open to its close, kept so the next popup
 * can hand it to the page to log.
 *
 * Chrome closes a popup on its own (the popup losing focus, the extension
 * reloading) and says nothing about why, and the page inside dies with it
 * before anything it logs is flushed. So each event is written at once and
 * synchronously to the popup's own `localStorage` (the extension's origin —
 * no permission needed, and it survives the close), and read back by the
 * next open.
 */
import {
  POPUP_TRACE_MAX_EVENTS,
  PopupTraceSchema,
  type PopupTrace,
  type PopupTraceEvent,
} from "../core/bridge";

/** The running popup's trace. */
const CURRENT_KEY = "equin.popup-trace.current";
/** The previous popup's, until the page takes it. */
const PREVIOUS_KEY = "equin.popup-trace.previous";

const startedAt = performance.now();

function load(key: string): PopupTrace | null {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  const parsed = PopupTraceSchema.safeParse(JSON.parse(raw));
  // A trace from another build of the shell, in another shape: there is
  // nothing to read in it, and it must not block the next one.
  if (!parsed.success) {
    localStorage.removeItem(key);
    return null;
  }
  return parsed.data;
}

/**
 * Start this popup's trace: the previous popup's becomes the one handed over
 * (an older one the page never took is replaced — the latest close is the one
 * to explain).
 */
export function startPopupTrace(shellDigest: string): void {
  const previous = load(CURRENT_KEY);
  if (previous !== null)
    localStorage.setItem(PREVIOUS_KEY, JSON.stringify(previous));
  trace = { openedAt: Date.now(), shellDigest, events: [], dropped: 0 };
  record("open", document.visibilityState);
}

// The popup document's own trace: one popup, one trace.
let trace: PopupTrace | null = null;

/** Note one event, written through at once. */
export function record(kind: PopupTraceEvent["kind"], detail = ""): void {
  if (trace === null)
    throw new Error("popup trace: record() before startPopupTrace()");
  if (trace.events.length < POPUP_TRACE_MAX_EVENTS)
    trace.events.push({
      at: Math.round(performance.now() - startedAt),
      kind,
      detail: detail.slice(0, 300),
    });
  else trace.dropped++;
  localStorage.setItem(CURRENT_KEY, JSON.stringify(trace));
}

/** The previous popup's trace, handed over once. */
export function takePreviousTrace(): PopupTrace | null {
  const previous = load(PREVIOUS_KEY);
  localStorage.removeItem(PREVIOUS_KEY);
  return previous;
}

/** What has focus in the popup, in words: whether the popup's window has it
 *  at all, and which element (the frame, when the page inside has it). */
function focusText(): string {
  const active = document.activeElement;
  const where = active === null ? "none" : active.tagName.toLowerCase();
  return `hasFocus=${document.hasFocus()} active=${where}`;
}

/**
 * Trace the popup window's own lifecycle. A `blur` with `hasFocus=false`
 * is the popup itself losing focus — what makes Chrome close it; a `blur`
 * while the frame is the active element is only focus moving into the page.
 */
export function tracePopupLifecycle(frame: HTMLIFrameElement): void {
  frame.addEventListener("load", () => record("frame-load"));
  window.addEventListener("focus", () => record("focus", focusText()));
  // Read after the blur settles: during the event, activeElement has not
  // moved yet.
  window.addEventListener("blur", () => {
    queueMicrotask(() => record("blur", focusText()));
  });
  document.addEventListener("visibilitychange", () =>
    record("visibility", document.visibilityState),
  );
  window.addEventListener("pagehide", (e) =>
    record("pagehide", `persisted=${e.persisted} ${focusText()}`),
  );
  window.addEventListener("error", (e) =>
    record("error", `${e.message} (${e.filename}:${e.lineno})`),
  );
  window.addEventListener("unhandledrejection", (e) =>
    record(
      "rejection",
      e.reason instanceof Error ? e.reason.message : String(e.reason),
    ),
  );
}
