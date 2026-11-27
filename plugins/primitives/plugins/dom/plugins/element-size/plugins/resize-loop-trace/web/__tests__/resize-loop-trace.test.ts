import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsResizeLoopError,
  installResizeLoopTrace,
  resizeLoopReportSink,
  type ResizeLoopReport,
} from "../internal/resize-loop-trace";

const LOOP = "ResizeObserver loop completed with undelivered notifications.";
// Past the episode's quiet gap (1 s) and its two frames.
const EPISODE_END = 1_100;

// A native observer the test delivers to by hand: deliver(observer, el, w, h)
// runs its callback as the browser would in a rendering step.
class FakeNativeObserver {
  static all: FakeNativeObserver[] = [];
  constructor(readonly callback: ResizeObserverCallback) {
    FakeNativeObserver.all.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

function deliver(
  index: number,
  target: Element,
  width: number,
  height: number,
) {
  const native = FakeNativeObserver.all[index]!;
  const entry = {
    target,
    contentRect: { width, height },
  } as ResizeObserverEntry;
  native.callback([entry], native as unknown as ResizeObserver);
}

function raiseLoop() {
  window.dispatchEvent(new ErrorEvent("error", { message: LOOP }));
}

let uninstall: () => void;
let reports: ResizeLoopReport[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", FakeNativeObserver);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 16),
  );
  FakeNativeObserver.all = [];
  reports = [];
  resizeLoopReportSink.register((r) => reports.push(r));
  uninstall = installResizeLoopTrace();
});

afterEach(() => {
  uninstall();
  resizeLoopReportSink.register(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("installResizeLoopTrace", () => {
  it("reports the step that raised the loop and the notifications held back to the next frame", () => {
    const inner = document.createElement("div");
    const outer = document.createElement("section");
    outer.appendChild(inner);
    document.body.appendChild(outer);
    const calls: Element[] = [];
    new ResizeObserver((entries) => calls.push(entries[0]!.target));
    new ResizeObserver(() => {});

    deliver(0, inner, 10, 20); // the step's callback
    raiseLoop();
    deliver(1, outer, 30, 40); // next frame: the held-back notification
    vi.advanceTimersByTime(EPISODE_END);

    expect(calls).toEqual([inner]); // the page's callback still runs
    expect(reports).toHaveLength(1);
    const [r] = reports;
    expect(r!.message).toBe(LOOP);
    expect(r!.pass.map((o) => o.entries[0]!.target)).toEqual([inner]);
    expect(r!.pass[0]!.entries[0]).toMatchObject({ width: 10, height: 20 });
    expect(r!.deferred.map((o) => o.entries[0]!.target)).toEqual([outer]);
    expect(r!.pass[0]!.site).toContain("resize-loop-trace.test.ts");
    outer.remove();
  });

  it("keeps only the current step's callbacks", () => {
    const el = document.createElement("div");
    new ResizeObserver(() => {});
    deliver(0, el, 1, 1);
    vi.advanceTimersByTime(1); // the step ends
    raiseLoop();
    vi.advanceTimersByTime(EPISODE_END);
    expect(reports).toHaveLength(1);
    expect(reports[0]!.pass).toEqual([]);
  });

  it("claims the loop errors it reports, and only while installed", () => {
    const loop = new ErrorEvent("error", { message: LOOP });
    const other = new ErrorEvent("error", { message: "boom" });
    window.dispatchEvent(loop);
    window.dispatchEvent(other);
    expect(claimsResizeLoopError(loop)).toBe(true);
    expect(claimsResizeLoopError(other)).toBe(false);
    vi.advanceTimersByTime(EPISODE_END);
    expect(reports).toHaveLength(1);
    uninstall();
    const after = new ErrorEvent("error", { message: LOOP });
    window.dispatchEvent(after);
    expect(claimsResizeLoopError(after)).toBe(false);
    uninstall = installResizeLoopTrace();
  });

  it("reports a run of loop errors less than a second apart once, with its count and duration", () => {
    const el = document.createElement("div");
    new ResizeObserver(() => {});
    for (let i = 0; i < 30; i++) {
      deliver(0, el, 1, 1);
      raiseLoop();
      vi.advanceTimersByTime(16);
    }
    expect(reports).toHaveLength(0); // still looping
    vi.advanceTimersByTime(EPISODE_END);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ occurrences: 30, durationMs: 29 * 16 });
    // The trace is the first error's.
    expect(reports[0]!.pass.map((o) => o.entries[0]!.target)).toEqual([el]);

    raiseLoop(); // after the quiet gap: a new episode
    vi.advanceTimersByTime(EPISODE_END);
    expect(reports).toHaveLength(2);
    expect(reports[1]!.occurrences).toBe(1);
  });

  it("reports a loop that never stops every 10 s, not never", () => {
    for (let i = 0; i < 700; i++) {
      raiseLoop();
      vi.advanceTimersByTime(16);
    }
    // 11.2 s of errors: the first episode was cut at 10 s.
    expect(reports).toHaveLength(1);
    expect(reports[0]!.occurrences).toBe(Math.ceil(10_000 / 16));
  });

  it("reports an episode still running when the page is left", () => {
    raiseLoop();
    vi.advanceTimersByTime(40); // its next step is captured
    window.dispatchEvent(new Event("pagehide"));
    expect(reports).toHaveLength(1);
  });

  it("reports an episode left before its next step was captured, with what it has", () => {
    const el = document.createElement("div");
    new ResizeObserver(() => {});
    deliver(0, el, 1, 1);
    raiseLoop();
    window.dispatchEvent(new Event("pagehide")); // no frame ran
    expect(reports).toHaveLength(1);
    expect(reports[0]!.pass.map((o) => o.entries[0]!.target)).toEqual([el]);
    expect(reports[0]!.deferred).toEqual([]);
    vi.advanceTimersByTime(EPISODE_END);
    expect(reports).toHaveLength(1); // not twice
  });

  it("reads an element with no box as the browser does: 0×0, whatever its specified size", () => {
    const hidden = document.createElement("div");
    hidden.style.display = "none";
    const inner = document.createElement("div");
    inner.style.width = "300px";
    inner.style.height = "40px";
    hidden.append(inner);
    document.body.append(hidden);
    const a = new ResizeObserver(() => {});
    a.observe(inner);
    deliver(0, inner, 0, 0);
    raiseLoop();
    vi.advanceTimersByTime(EPISODE_END);
    expect(reports[0]!.heldBack).toEqual([]);
    hidden.remove();
  });

  it("names the observations still out of date when the error fires: the held-back ones", () => {
    const steady = document.createElement("div");
    steady.style.width = "10px";
    steady.style.height = "20px";
    const resized = document.createElement("div");
    resized.style.width = "50px";
    resized.style.height = "20px";
    const detached = document.createElement("div");
    const fresh = document.createElement("div");
    document.body.append(steady, resized, detached, fresh);
    const a = new ResizeObserver(() => {});
    const b = new ResizeObserver(() => {});
    a.observe(steady);
    a.observe(resized);
    b.observe(detached);
    deliver(0, steady, 10, 20); // what it is: delivered
    deliver(0, resized, 10, 20); // resized since it was delivered
    deliver(1, detached, 5, 5);
    detached.remove(); // detached since: the browser reports 0×0
    b.observe(fresh); // never delivered
    raiseLoop();
    vi.advanceTimersByTime(EPISODE_END);

    const held = reports[0]!.heldBack;
    expect(held.map((h) => h.target)).toEqual(
      expect.arrayContaining([resized, detached, fresh]),
    );
    expect(held.map((h) => h.target)).not.toContain(steady);
    expect(held.find((h) => h.target === resized)).toMatchObject({
      width: 50,
      height: 20,
      reported: { width: 10, height: 20 },
      connected: true,
    });
    expect(held.find((h) => h.target === detached)).toMatchObject({
      width: 0,
      height: 0,
      reported: { width: 5, height: 5 },
      connected: false,
    });
    expect(held.find((h) => h.target === fresh)!.reported).toBeNull();
    expect(held[0]!.site).toContain("resize-loop-trace.test.ts");
    steady.remove();
    resized.remove();
    fresh.remove();
  });

  it("forgets what is unobserved or disconnected", () => {
    const el = document.createElement("div");
    document.body.append(el);
    const a = new ResizeObserver(() => {});
    const b = new ResizeObserver(() => {});
    a.observe(el);
    b.observe(el);
    a.unobserve(el);
    b.disconnect();
    raiseLoop();
    vi.advanceTimersByTime(EPISODE_END);
    expect(reports[0]!.heldBack).toEqual([]);
    el.remove();
  });
});
