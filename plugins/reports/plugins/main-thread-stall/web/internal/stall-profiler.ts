import { clientLog } from "@plugins/primitives/plugins/log-channels/web";
import type { StallStacks } from "@plugins/reports/plugins/main-thread-stall/plugins/tab-evidence/core";
import type { MainThreadStallDraft } from "../../core";
import {
  asEpochMs,
  epochNow,
  readClocks,
  type ClockReading,
  type EpochMs,
} from "@plugins/primitives/plugins/perfs/plugins/page-clock/core";
import { LOG_CHANNEL } from "./log-channel";
import {
  reduceStallStacks,
  type KeptTrace,
  type ProfilerTrace,
} from "./stack-profile";

// The tab's rolling JS Self-Profiling sampler (Chrome's `Profiler`; the
// gateway serves every app document with `Document-Policy: js-profiling`).
// LoAF names a frozen frame's entry point only; a sampling profiler's samples
// are taken by V8 off the main thread, so the profiler running when the
// thread froze keeps sampling THROUGH the freeze — and once the tab is back,
// the stacks that ran underneath can be read from it.
//
// Sampling is cheap; READING is not. `Profiler.stop()` builds the whole trace
// on the main thread before it returns (blink's ProfilerTraceBuilder: one
// object per sample, plus a stack and a frame per distinct call-tree node),
// so its cost grows with how much, and how varied, JS ran — 364 ms inside a
// visitor's click (report-1795329907-j415mx). So a trace is built ONLY when
// evidence asks for one (`stacksIn`, or the tab going hidden — below); a
// profiler nobody asked about is let go unstopped: dropped, V8 discards its
// samples when the wrapper is collected (blink's pre-finalizer cancels it),
// with no trace built.
//
// Coverage: a new profiler starts every ROTATE_MS (on the watchdog's 1 Hz
// ping, or the fallback's heartbeat — no timer of its own; a frozen thread
// starts nothing, so the one sampling through a freeze is never cut), so the
// youngest one that began before a window has most of its buffer left for it.
// The one it superseded stays alive (still sampling) as a standby for
// RETAIN_MS — a stall is filed ~2 s after it ends, a slow interaction ~1 s
// after its paint — then is let go. Evidence for a window stops the youngest
// live profiler that began before the window (and, should its buffer have
// filled, the next ones): that trace alone covers the window.
//
// A let-go profiler lives until garbage collection, and Chrome refuses a page
// more than 100 at once: while MAX_RELEASED let-go ones (and standbys) are
// not yet collected — a tab that has not collected garbage for minutes — a
// superseded profiler is built at once instead (a 30 s trace, as before).

export const PROFILE = {
  // 20 ms: 50 samples a second — a minutes-long loop yields thousands of
  // samples, far more than enough to name it, at a cost V8 pays on its
  // sampler thread (a signal + stack walk per sample, microseconds).
  SAMPLE_INTERVAL_MS: 20,
  // 15 000 samples = 300 s of sampling: a profiler at most ROTATE_MS old when
  // a freeze begins covers its first 270 s (longer ones are marked truncated).
  MAX_BUFFER_SAMPLES: 15_000,
  ROTATE_MS: 30_000,
  /** A superseded profiler stays alive this long; a built trace is kept as long. */
  RETAIN_MS: 90_000,
  RETAIN_TRACES: 4,
  /** Let-go profilers not yet collected before one is stopped instead (Chrome's cap is 100). */
  MAX_RELEASED: 6,
} as const;

export interface ProfilerInstance extends EventTarget {
  stop(): Promise<ProfilerTrace>;
}
export type ProfilerCtor = new (opts: {
  sampleInterval: number;
  maxBufferSize: number;
}) => ProfilerInstance;

interface Run {
  id: number;
  profiler: ProfilerInstance;
  startedAt: EpochMs;
  /** Both clocks read at its start and on each pulse (KeptTrace.clocks). */
  clocks: ClockReading[];
  full: boolean;
  /** When the next one started: from then on it is a standby. */
  supersededAt: EpochMs | null;
}

/** What a built (or being built) trace covers. */
interface Span {
  id: number;
  startedAt: number;
  stoppedAt: number;
  full: boolean;
}

/** A built trace, named by its run. */
type Built = KeptTrace & { id: number };

/** How far a profiler's samples reach: its stop, else open — unless its buffer filled. */
function reachOf(at: number, full: boolean, stoppedAt: number): number {
  // Where a filled buffer's samples end is only known once read; its nominal
  // span is the bound.
  const filled = at + PROFILE.MAX_BUFFER_SAMPLES * PROFILE.SAMPLE_INTERVAL_MS;
  return full ? Math.min(filled, stoppedAt) : stoppedAt;
}

export interface StallProfiler {
  /** The clock moved (a watchdog ping, a heartbeat): start, roll over, let go. */
  pulse(): void;
  /** The stacks of a stall this tab is filing (its own, recovered — else why not). */
  stacksFor(
    draft: MainThreadStallDraft,
    ownTabId: string,
  ): Promise<StallStacks>;
  /**
   * The stacks this tab's own thread ran in `[startedAt, endedAt)` (epoch
   * ms) — a window it was alive through (a slow interaction it measured).
   * Builds the one trace that covers it.
   */
  stacksIn(window: {
    startedAt: EpochMs;
    endedAt: EpochMs;
  }): Promise<StallStacks>;
  dispose(): void;
}

export interface ProfilerPool extends StallProfiler {
  /** The tab was shown or hidden. */
  visibility(visible: boolean): void;
}

/** Calls `onCollected` once for each registered object garbage-collected. */
export type Collector = (onCollected: () => void) => {
  register(target: object): void;
};

const finalizationRegistry: Collector = (onCollected) => {
  const registry = new FinalizationRegistry<null>(onCollected);
  return { register: (target) => registry.register(target, null) };
};

/**
 * The sampler over an injected `Profiler` (null: the browser has none) — the
 * tab installs it over the page's own (`installStallProfiler`); tests drive it
 * with a fake.
 */
export function createProfilerPool(deps: {
  Profiler: ProfilerCtor | null;
  visible: () => boolean;
  log: (line: Record<string, unknown>) => void;
  /** Counts let-go profilers out as they are collected (tests: by hand). */
  registry?: Collector;
}): ProfilerPool {
  const { Profiler: Ctor, visible, log } = deps;
  // Why this tab cannot sample, once known: the report says so.
  let unavailable: string | null = Ctor
    ? null
    : "this browser has no JS Self-Profiling API (no `Profiler` global: Chromium only, secure contexts only)";
  let current: Run | null = null;
  /** Superseded, still sampling, oldest first. */
  let standby: Run[] = [];
  let kept: Built[] = [];
  /** Being built: a kept trace once its stop settles. */
  const stopping = new Set<Span>();
  // Stops in flight: each settles to null, or to the error its stop threw.
  const pending = new Set<Promise<Error | null>>();
  let nextId = 0;
  /** Let go, not yet collected. */
  let released = 0;
  const collected = (deps.registry ?? finalizationRegistry)(() => {
    released--;
  });
  let capLogged = false;
  let disposed = false;

  if (unavailable) log({ unavailable });

  const prune = (): void => {
    const now = epochNow();
    kept = kept
      .filter((k) => now - k.stoppedAt <= PROFILE.RETAIN_MS)
      .slice(-PROFILE.RETAIN_TRACES);
  };

  /** Build its trace (the main-thread cost) and keep it. */
  const stop = (run: Run): void => {
    // Read in the task that stops it: every sample predates this instant.
    const stoppedAt = epochNow();
    const clocks = [...run.clocks, readClocks()];
    const span: Span = {
      id: run.id,
      startedAt: run.startedAt,
      stoppedAt,
      full: run.full,
    };
    stopping.add(span);
    const settled = run.profiler.stop().then(
      (trace) => {
        stopping.delete(span);
        if (disposed) return null;
        kept.push({
          id: run.id,
          trace,
          clocks,
          startedAt: run.startedAt,
          stoppedAt,
          full: run.full,
        });
        prune();
        return null;
      },
      (err: unknown) => {
        stopping.delete(span);
        const e = err instanceof Error ? err : new Error(String(err));
        log({ stopFailed: e.message });
        return e;
      },
    );
    pending.add(settled);
    void settled.then(() => pending.delete(settled));
  };

  const overCap = (): boolean => {
    if (released + standby.length < PROFILE.MAX_RELEASED) return false;
    if (!capLogged) {
      capLogged = true;
      log({ releasedUncollected: released, standby: standby.length });
    }
    return true;
  };

  /**
   * Let it go without building its trace — or, past the cap, stop it to free
   * its slot (the trace is discarded: it is the cap's cost, not evidence).
   */
  const release = (run: Run): void => {
    if (released >= PROFILE.MAX_RELEASED) {
      overCap();
      void run.profiler.stop().then(
        () => undefined,
        (err: unknown) => {
          log({
            stopFailed: err instanceof Error ? err.message : String(err),
          });
        },
      );
      return;
    }
    released++;
    collected.register(run.profiler);
  };

  const start = (): void => {
    if (!Ctor || unavailable || current || disposed) return;
    if (!visible()) return;
    let profiler: ProfilerInstance;
    try {
      profiler = new Ctor({
        sampleInterval: PROFILE.SAMPLE_INTERVAL_MS,
        maxBufferSize: PROFILE.MAX_BUFFER_SAMPLES,
      });
    } catch (err) {
      // The document was served without `Document-Policy: js-profiling` (a
      // gateway older than it, a host that serves the shell itself): Chrome
      // refuses with a DOMException. Anything else is a bug — thrown.
      if (!(err instanceof DOMException)) throw err;
      unavailable = `the browser refused to start a Profiler (${err.name}: ${err.message}) — is the document served with \`Document-Policy: js-profiling\`?`;
      log({ unavailable });
      return;
    }
    const run: Run = {
      id: nextId++,
      profiler,
      startedAt: epochNow(),
      clocks: [readClocks()],
      full: false,
      supersededAt: null,
    };
    // Fires once the thread is back: the buffer is spent, start a fresh one.
    profiler.addEventListener("samplebufferfull", () => {
      run.full = true;
      if (current === run) rollOver();
    });
    current = run;
  };

  /**
   * The next one starts; this one becomes a standby — unless the let-go
   * profilers are not being collected (past the cap), when it is built now,
   * as a 30 s trace, rather than as a 120 s one once let go.
   */
  const rollOver = (): void => {
    const prev = current;
    current = null;
    start();
    if (!prev) return;
    if (overCap()) {
      stop(prev);
      return;
    }
    prev.supersededAt = epochNow();
    standby.push(prev);
  };

  /** Stop a live run (the current one hands over first: no gap). */
  const materialize = (run: Run): void => {
    if (run === current) {
      current = null;
      start();
    } else standby = standby.filter((r) => r !== run);
    stop(run);
  };

  /**
   * The profilers whose traces cover `[startedAt, endedAt)`, each with the
   * instant its part begins: from `startedAt` on, the one covering the
   * current instant — a built one if it reaches the end, else the youngest
   * live one that does (the smallest trace), else the one reaching furthest —
   * until the end is reached. Live ones chosen are stopped (built). Null when
   * none covers `startedAt`.
   */
  const cover = (
    startedAt: number,
    endedAt: number,
  ): { id: number; from: number }[] | null => {
    const items = [
      ...[...kept, ...stopping].map((s) => ({
        id: s.id,
        at: s.startedAt,
        reach: reachOf(s.startedAt, s.full, s.stoppedAt),
        run: null as Run | null,
      })),
      ...[...standby, ...(current ? [current] : [])].map((run) => ({
        id: run.id,
        at: run.startedAt,
        reach: reachOf(run.startedAt, run.full, Number.POSITIVE_INFINITY),
        run: run as Run | null,
      })),
    ];
    const chain: { item: (typeof items)[number]; from: number }[] = [];
    let t = startedAt;
    while (t < endedAt) {
      const now = t;
      const cands = items.filter(
        (i) => i.at <= now && i.reach > now && !chain.some((c) => c.item === i),
      );
      if (cands.length === 0) break;
      const reaching = cands.filter((i) => i.reach >= endedAt);
      const pick =
        reaching.find((i) => i.run === null) ??
        reaching.sort((a, b) => b.at - a.at)[0] ??
        cands.sort((a, b) => b.reach - a.reach)[0]!;
      chain.push({ item: pick, from: t });
      t = pick.reach;
    }
    if (chain.length === 0) return null;
    for (const c of chain) if (c.item.run) materialize(c.item.run);
    return chain.map((c) => ({ id: c.item.id, from: c.from }));
  };

  const stacksIn = async (window: {
    startedAt: EpochMs;
    endedAt: EpochMs;
  }): Promise<StallStacks> => {
    if (unavailable) return { kind: "unavailable", reason: unavailable };
    const parts = cover(window.startedAt, window.endedAt) ?? [];
    const errors = (await Promise.all([...pending])).filter(
      (e): e is Error => e !== null,
    );
    const failed = errors[0];
    if (failed)
      return {
        kind: "unavailable",
        reason: `the profiler's trace could not be read: ${failed.message}`,
      };
    // Each part owns its instants from `from` (none: the reduction says no
    // profile covers the start).
    const traces: KeptTrace[] = [];
    for (const part of parts) {
      const built = kept.find((k) => k.id === part.id);
      if (!built)
        return {
          kind: "unavailable",
          reason:
            "a trace covering the window was dropped before it could be read (more traces built at once than are kept)",
        };
      traces.push(
        part.from > built.startedAt
          ? { ...built, from: asEpochMs(part.from) }
          : built,
      );
    }
    return reduceStallStacks({
      traces,
      startedAt: window.startedAt,
      endedAt: window.endedAt,
      sampleIntervalMs: PROFILE.SAMPLE_INTERVAL_MS,
    });
  };

  return {
    visibility(isVisible) {
      if (isVisible) {
        start();
        return;
      }
      // A hidden tab's stalls are never reported: sample nothing there. A
      // report about the moments before it was hidden may still be filed (a
      // stall settles 2 s, an interaction is judged 1 s after its paint), so
      // the oldest live run — covering them all, unless its buffer filled,
      // when the next one is built too — is built (off screen), the rest let
      // go.
      const live = [...standby, ...(current ? [current] : [])];
      current = null;
      standby = [];
      let i = 0;
      for (; i < live.length; i++) {
        stop(live[i]!);
        if (!live[i]!.full) break;
      }
      for (const run of live.slice(i + 1)) release(run);
    },
    pulse() {
      if (!current) start();
      else if (epochNow() - current.startedAt >= PROFILE.ROTATE_MS) rollOver();
      const now = epochNow();
      for (const run of standby)
        if (
          run.supersededAt !== null &&
          now - run.supersededAt > PROFILE.RETAIN_MS
        )
          release(run);
      standby = standby.filter(
        (run) =>
          run.supersededAt === null ||
          now - run.supersededAt <= PROFILE.RETAIN_MS,
      );
      // A reading each second places its samples across a sleep it ran
      // through (bounded: ≤ (ROTATE_MS + RETAIN_MS) / ping interval per run).
      const reading = readClocks();
      for (const run of [...standby, ...(current ? [current] : [])])
        run.clocks.push(reading);
      prune();
    },
    async stacksFor(draft, ownTabId) {
      if (draft.ended !== "recovered")
        return {
          kind: "unavailable",
          reason: `the tab did not survive the stall (${draft.ended}): its profile went with it`,
        };
      if (draft.tabId !== ownTabId)
        return {
          kind: "unavailable",
          reason:
            "filed by another tab: only the stalled tab holds the profile of its own thread",
        };
      // The watchdog measured it on the wall clock (`Date.now()` pongs).
      return stacksIn({
        startedAt: asEpochMs(draft.startedAt),
        endedAt: asEpochMs(draft.endedAt),
      });
    },
    stacksIn,
    dispose() {
      disposed = true;
      for (const run of [...standby, ...(current ? [current] : [])])
        release(run);
      current = null;
      standby = [];
      kept = [];
    },
  };
}

export function installStallProfiler(): StallProfiler {
  const g = globalThis as unknown as { Profiler?: ProfilerCtor };
  const pool = createProfilerPool({
    Profiler: g.Profiler ?? null,
    visible: () => document.visibilityState === "visible",
    log: (line) =>
      clientLog(LOG_CHANNEL, JSON.stringify({ kind: "profiler", ...line })),
  });
  const onVisibility = (): void =>
    pool.visibility(document.visibilityState === "visible");
  document.addEventListener("visibilitychange", onVisibility);
  return {
    pulse: pool.pulse,
    stacksFor: pool.stacksFor,
    stacksIn: pool.stacksIn,
    dispose() {
      document.removeEventListener("visibilitychange", onVisibility);
      pool.dispose();
    },
  };
}
