import { generatesBox } from "@plugins/primitives/plugins/dom/plugins/box-presence/web";
import { defineReportSink } from "@plugins/primitives/plugins/report-sink/core";

// "ResizeObserver loop completed with undelivered notifications." (Chrome,
// Firefox, Safari) or the older "ResizeObserver loop limit exceeded". The
// browser raises it as a bare ErrorEvent — no Error, so no stack — once a
// rendering step ends with a resize it could not deliver: an observer callback
// in that step resized an element at or above the depth of the ones just
// delivered. Nothing in the event says which callback, or which element.
const LOOP_MESSAGE_PREFIX = "ResizeObserver loop";

// A pass is the observer callbacks of one rendering step. Past this many the
// rest are counted, not kept: this runs on every callback of the page.
const PASS_CAP = 50;

// Held-back observations kept per report; the rest are counted.
const HELD_BACK_CAP = 50;

/**
 * Loop errors less than this apart are one episode: a loop that re-arms itself
 * raises one error per frame (report-1795480778-ddn9y9: 489 in ~4 s from one
 * tab, each its own report, request and supervisor event). The episode is
 * reported once, when it has been quiet this long, with how many errors it
 * raised and for how long.
 */
const EPISODE_GAP_MS = 1_000;

/** An episode still raising errors after this long is reported anyway, and
 * the next error starts another: a loop that never stops reports every 10 s,
 * not every frame — and not never. */
const EPISODE_MAX_MS = 10_000;

/** One observer callback: where the observer was created, and what it was
 * handed — each entry's target and the content size it reported. */
export interface ResizeLoopObservation {
  /** The first frames of the stack that created the observer, or null when
   * the engine gave none. */
  site: string | null;
  entries: readonly { target: Element; width: number; height: number }[];
}

/**
 * An observation the browser held back when it raised the loop error: its
 * target's size had changed since the size it last reported (or it had never
 * reported one), read in the error event itself — right after the step, where
 * every notification the step could deliver has been delivered, so the ones
 * still out of date ARE the undelivered ones.
 */
export interface ResizeLoopHeldBack {
  site: string | null;
  target: Element;
  /** The size the browser would report now (0×0 for a detached target) —
   * logical: `width` is the inline size, `height` the block size, which only
   * differ from the physical ones in a vertical writing mode. */
  width: number;
  height: number;
  /** The size it last reported, or null when it never reported one. */
  reported: { width: number; height: number } | null;
  /** Whether the target was in the document when the error was raised. */
  connected: boolean;
}

/** A loop episode, with what caused it, taken at its FIRST error: `pass` is
 * every callback of the step that raised it; `heldBack` the observations that
 * step could not deliver; `deferred` the callbacks of the next step (the
 * held-back ones among them, with whatever else resized meanwhile).
 * `occurrences` is how many loop errors the episode raised, `durationMs` from
 * its first to its last. */
export interface ResizeLoopReport {
  message: string;
  pass: readonly ResizeLoopObservation[];
  omittedPass: number;
  heldBack: readonly ResizeLoopHeldBack[];
  omittedHeldBack: number;
  deferred: readonly ResizeLoopObservation[];
  omittedDeferred: number;
  occurrences: number;
  durationMs: number;
}

export const resizeLoopReportSink = defineReportSink<ResizeLoopReport>(
  "primitives/plugins/dom/plugins/element-size/plugins/resize-loop-trace:resizeLoopReportSink",
);

type Recorded = {
  created: Error;
  entries: readonly ResizeObserverEntry[];
};

type Pass = { kept: Recorded[]; omitted: number };

type Size = { width: number; height: number };

/** One target of a traced observer: the box it observes, and the size the
 * browser last reported for it (null until the first notification) — logical
 * (inline × block), as the entry's box sizes are. The target is held weakly,
 * as the browser's own observer holds it: a target dropped without
 * `unobserve` must not be kept alive by the tracer. */
type Watched = {
  ref: WeakRef<Element>;
  box: ResizeObserverBoxOptions;
  reported: Size | null;
};

// The loop errors an installed tracer took — marked by its capture listener,
// which runs before any bubble-phase listener on the window.
const claimed = new WeakSet<ErrorEvent>();

/** Whether a tracer took this window error and will report it itself, so the
 * window-error reporter must not file it a second time. */
export function claimsResizeLoopError(e: ErrorEvent): boolean {
  return claimed.has(e);
}

function isLoopError(e: ErrorEvent): boolean {
  return (
    e.error == null &&
    typeof e.message === "string" &&
    e.message.startsWith(LOOP_MESSAGE_PREFIX)
  );
}

/**
 * Replaces the page's `ResizeObserver` with a subclass that remembers each
 * callback of the current rendering step and every observation's last
 * reported size, and reports every loop EPISODE on
 * {@link resizeLoopReportSink}. Call it once, before anything creates an
 * observer (main.tsx imports it first). Returns the uninstall.
 */
export function installResizeLoopTrace(): () => void {
  const Native = globalThis.ResizeObserver;

  let pass: Pass = { kept: [], omitted: 0 };
  let passEndScheduled = false;
  // The next steps' callbacks, one list per loop error still waiting for
  // the notifications it held back.
  const captures = new Set<Pass>();
  // Every live traced observer, weakly: an observer the page dropped without
  // disconnecting is the browser's to collect, not ours to keep. A collected
  // one leaves the set through the registry; a disconnected one leaves it at
  // once.
  const observers = new Set<WeakRef<TracedResizeObserver>>();
  const collected = new FinalizationRegistry<WeakRef<TracedResizeObserver>>(
    (ref) => observers.delete(ref),
  );

  function push(into: Pass, recorded: Recorded): void {
    if (into.kept.length < PASS_CAP) into.kept.push(recorded);
    else into.omitted++;
  }

  function record(created: Error, entries: ResizeObserverEntry[]): void {
    const recorded = { created, entries };
    push(pass, recorded);
    for (const capture of captures) push(capture, recorded);
    // Every callback of a step — and the loop error closing it — runs inside
    // one task, so the pass ends with the next one. Scheduled once per step
    // that delivered anything.
    if (!passEndScheduled) {
      passEndScheduled = true;
      setTimeout(() => {
        pass = { kept: [], omitted: 0 };
        passEndScheduled = false;
      }, 0);
    }
  }

  class TracedResizeObserver extends Native {
    readonly created: Error;
    readonly self: WeakRef<TracedResizeObserver>;
    watched = new WeakMap<Element, Watched>();
    readonly targets = new Set<Watched>();
    constructor(callback: ResizeObserverCallback) {
      // Its stack is read only when a loop is reported.
      const created = new Error();
      super((entries, observer) => {
        record(created, entries);
        // `observer` is this instance (or a subclass of it), which the
        // callback cannot name as `this` before super() returns.
        const watched = (observer as TracedResizeObserver).watched;
        for (const entry of entries) {
          const w = watched.get(entry.target);
          if (w) w.reported = reportedSize(entry, w.box);
        }
        callback.call(observer, entries, observer);
      });
      this.created = created;
      this.self = new WeakRef(this);
      observers.add(this.self);
      collected.register(this, this.self);
    }
    override observe(el: Element, options?: ResizeObserverOptions): void {
      super.observe(el, options);
      // Observing again (with other options) is a new observation: nothing
      // reported for it yet.
      this.forget(el);
      const w: Watched = {
        ref: new WeakRef(el),
        box: options?.box ?? "content-box",
        reported: null,
      };
      this.watched.set(el, w);
      this.targets.add(w);
      if (!observers.has(this.self)) observers.add(this.self);
    }
    override unobserve(el: Element): void {
      super.unobserve(el);
      this.forget(el);
    }
    override disconnect(): void {
      super.disconnect();
      this.watched = new WeakMap();
      this.targets.clear();
      observers.delete(this.self);
    }
    private forget(el: Element): void {
      const w = this.watched.get(el);
      if (!w) return;
      this.watched.delete(el);
      this.targets.delete(w);
    }
  }

  /** The observations still out of date right after the step — the ones it
   * held back. */
  function heldBackNow(): { kept: ResizeLoopHeldBack[]; omitted: number } {
    const kept: ResizeLoopHeldBack[] = [];
    let omitted = 0;
    for (const ref of observers) {
      const observer = ref.deref();
      if (!observer) {
        observers.delete(ref);
        continue;
      }
      for (const w of observer.targets) {
        const target = w.ref.deref();
        if (!target) {
          observer.targets.delete(w);
          continue;
        }
        const connected = target.isConnected;
        const now = currentSize(target, w.box, connected);
        // Not readable the way the browser reads it (an SVG element's size is
        // its bounding box in user units): only a detached one is known to be
        // out of date.
        if (now === null && connected) continue;
        const size = now ?? { width: 0, height: 0 };
        if (w.reported && sameSize(w.reported, size)) continue;
        if (kept.length >= HELD_BACK_CAP) {
          omitted++;
          continue;
        }
        kept.push({
          site: creationSite(observer.created),
          target,
          ...size,
          reported: w.reported,
          connected,
        });
      }
    }
    return { kept, omitted };
  }

  type Episode = {
    message: string;
    first: number;
    last: number;
    occurrences: number;
    // The first error's trace: taken at once, but for the next step's
    // callbacks, captured over the next two frames.
    raised: Pass;
    heldBack: { kept: ResizeLoopHeldBack[]; omitted: number };
    deferred: Pass;
    framesDone: boolean;
    ended: boolean;
    emitted: boolean;
    quiet: ReturnType<typeof setTimeout> | null;
  };
  let episode: Episode | null = null;

  /** Emit once the episode has ended and its next step is captured — or at
   * once when `now` (the page is going away: the next step will not come). */
  function emitIfDone(ep: Episode, now = false): void {
    if (ep.emitted || !ep.ended || (!ep.framesDone && !now)) return;
    ep.emitted = true;
    waiting.delete(ep);
    captures.delete(ep.deferred);
    resizeLoopReportSink.emit({
      message: ep.message,
      pass: ep.raised.kept.map(observation),
      omittedPass: ep.raised.omitted,
      heldBack: ep.heldBack.kept,
      omittedHeldBack: ep.heldBack.omitted,
      deferred: ep.deferred.kept.map(observation),
      omittedDeferred: ep.deferred.omitted,
      occurrences: ep.occurrences,
      durationMs: Math.round(ep.last - ep.first),
    });
  }

  function end(ep: Episode, now = false): void {
    if (!ep.ended) {
      ep.ended = true;
      if (ep.quiet !== null) clearTimeout(ep.quiet);
      if (episode === ep) episode = null;
    }
    emitIfDone(ep, now);
  }

  function onError(e: ErrorEvent): void {
    if (!isLoopError(e)) return;
    claimed.add(e);
    const now = performance.now();
    const open = episode;
    if (open && now - open.first < EPISODE_MAX_MS) {
      open.occurrences++;
      open.last = now;
      if (open.quiet !== null) clearTimeout(open.quiet);
      open.quiet = setTimeout(() => end(open), EPISODE_GAP_MS);
      return;
    }
    if (open) end(open);
    const deferred: Pass = { kept: [], omitted: 0 };
    captures.add(deferred);
    const ep: Episode = {
      message: e.message,
      first: now,
      last: now,
      occurrences: 1,
      // A copy: the step's pass keeps filling until its task ends.
      raised: { kept: [...pass.kept], omitted: pass.omitted },
      heldBack: heldBackNow(),
      deferred,
      framesDone: false,
      ended: false,
      emitted: false,
      quiet: null,
    };
    ep.quiet = setTimeout(() => end(ep), EPISODE_GAP_MS);
    episode = ep;
    waiting.add(ep);
    // The loop error fires after this frame's animation callbacks: the first
    // runs at the start of the next frame, before its observers deliver what
    // was held back; the second at the start of the one after.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        captures.delete(deferred);
        ep.framesDone = true;
        emitIfDone(ep);
      }),
    );
  }

  // Leaving the page ends the episode where it stands — with whatever of its
  // next step was captured — and reports it: a loop running until the tab
  // closes, or one that started a frame before a navigation, is still
  // reported. An ended one still waiting for its frames goes too.
  const waiting = new Set<Episode>();
  function onPageHide(): void {
    if (episode) end(episode, true);
    for (const ep of waiting) emitIfDone(ep, true);
    waiting.clear();
  }

  globalThis.ResizeObserver = TracedResizeObserver;
  window.addEventListener("error", onError, true);
  window.addEventListener("pagehide", onPageHide);
  return () => {
    window.removeEventListener("error", onError, true);
    window.removeEventListener("pagehide", onPageHide);
    if (episode?.quiet != null) clearTimeout(episode.quiet);
    episode = null;
    // Uninstalled: nothing more is reported, not even an episode waiting for
    // its frames.
    for (const ep of waiting) ep.emitted = true;
    waiting.clear();
    globalThis.ResizeObserver = Native;
  };
}

/** The size an entry reported for the box its observation watches. */
function reportedSize(
  entry: ResizeObserverEntry,
  box: ResizeObserverBoxOptions,
): Size {
  const sizes =
    box === "border-box" ? entry.borderBoxSize : entry.contentBoxSize;
  const first = sizes?.[0];
  if (first) return { width: first.inlineSize, height: first.blockSize };
  return { width: entry.contentRect.width, height: entry.contentRect.height };
}

/**
 * The size the browser would report for `el` now, read the way it reads it —
 * logical (inline × block), as the entry's box sizes are: the layout box from
 * computed style (untransformed), less the scrollbar gutters for the content
 * box (a classic scrollbar narrows the content box, not the used size — as
 * after-layout's `boxOf` reads it), 0×0 for an element that generates no box
 * (detached, display: none or under it, display: contents) and for an inline
 * box. Null where computed style cannot say (an SVG element, whose observed
 * size is its bounding box in user units). Read only when a loop error fires,
 * once per episode.
 */
function currentSize(
  el: Element,
  box: ResizeObserverBoxOptions,
  connected: boolean,
): Size | null {
  if (!connected || !generatesBox(el)) return { width: 0, height: 0 };
  if (!(el instanceof HTMLElement)) return null;
  const cs = getComputedStyle(el);
  const px = (v: string) => parseFloat(v) || 0;
  const borderX = px(cs.borderLeftWidth) + px(cs.borderRightWidth);
  const borderY = px(cs.borderTopWidth) + px(cs.borderBottomWidth);
  const padX = px(cs.paddingLeft) + px(cs.paddingRight);
  const padY = px(cs.paddingTop) + px(cs.paddingBottom);
  // `auto` (an inline box) reads 0, as the browser reports it.
  const usedW = px(cs.width);
  const usedH = px(cs.height);
  const borderBox = cs.boxSizing === "border-box";
  let width: number;
  let height: number;
  if (box === "border-box") {
    width = borderBox ? usedW : usedW + padX + borderX;
    height = borderBox ? usedH : usedH + padY + borderY;
  } else {
    const gutterX = Math.max(0, el.offsetWidth - el.clientWidth - borderX);
    const gutterY = Math.max(0, el.offsetHeight - el.clientHeight - borderY);
    width = Math.max(0, (borderBox ? usedW - padX - borderX : usedW) - gutterX);
    height = Math.max(
      0,
      (borderBox ? usedH - padY - borderY : usedH) - gutterY,
    );
  }
  return cs.writingMode.startsWith("vertical") ||
    cs.writingMode.startsWith("sideways")
    ? { width: height, height: width }
    : { width, height };
}

function sameSize(a: Size, b: Size): boolean {
  return (
    Math.abs(a.width - b.width) < 0.01 && Math.abs(a.height - b.height) < 0.01
  );
}

function observation({ created, entries }: Recorded): ResizeLoopObservation {
  return {
    site: creationSite(created),
    entries: entries.map((e) => ({
      target: e.target,
      width: e.contentRect.width,
      height: e.contentRect.height,
    })),
  };
}

// The frames above the TracedResizeObserver constructor: V8 heads a stack with
// the message line, Firefox and Safari do not; the first frame is always the
// constructor itself.
function creationSite(created: Error): string | null {
  const frames = (created.stack ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at ") || line.includes("@"));
  const callers = frames.slice(1, 4);
  return callers.length > 0 ? callers.join("\n") : null;
}
