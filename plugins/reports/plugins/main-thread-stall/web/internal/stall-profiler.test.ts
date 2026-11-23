// The sampler builds a trace only when evidence asks for one: rolling over
// never stops a profiler (stop() builds the whole trace on the main thread —
// 364 ms inside a visitor's click, report-1795329907-j415mx), a superseded
// one is let go unstopped once nobody can ask about it, and a window's
// evidence stops exactly the youngest profiler that covers it. Both clocks
// are stubbed; the Profiler is a fake that samples `spin` every 20 ms.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { asEpochMs } from "@plugins/primitives/plugins/perfs/plugins/page-clock/core";
import type { ProfilerTrace } from "./stack-profile";
import {
  createProfilerPool,
  PROFILE,
  type ProfilerCtor,
  type ProfilerInstance,
} from "./stall-profiler";

const T0 = 1_763_500_000_000;
const clock = { wall: T0, perf: 0 };
const spies: { mockRestore(): void }[] = [];
beforeEach(() => {
  clock.wall = T0;
  clock.perf = 0;
  spies.push(
    spyOn(Date, "now").mockImplementation(() => clock.wall),
    spyOn(performance, "now").mockImplementation(() => clock.perf),
  );
});
afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
});

interface Fake {
  startedPerf: number;
  stopped: boolean;
  /** The browser's event: its sample buffer is spent. */
  fill(): void;
}

function fakeProfiler(): { Ctor: ProfilerCtor; made: Fake[] } {
  const made: Fake[] = [];
  class FakeProfiler extends EventTarget implements ProfilerInstance {
    readonly me: Fake = {
      startedPerf: clock.perf,
      stopped: false,
      fill: () => this.dispatchEvent(new Event("samplebufferfull")),
    };
    constructor() {
      super();
      made.push(this.me);
    }
    stop(): Promise<ProfilerTrace> {
      if (this.me.stopped) throw new Error("stopped twice");
      this.me.stopped = true;
      const samples: ProfilerTrace["samples"] = [];
      for (let t = this.me.startedPerf; t < clock.perf; t += 20)
        samples.push({ timestamp: t, stackId: 0 });
      return Promise.resolve({
        resources: ["http://x/app.js"],
        frames: [{ name: "spin", resourceId: 0, line: 1, column: 1 }],
        stacks: [{ frameId: 0 }],
        samples,
      });
    }
  }
  return { Ctor: FakeProfiler, made };
}

/** Seconds pass with the tab answering every ping. */
function run(pool: { pulse(): void }, seconds: number): void {
  for (let i = 0; i < seconds; i++) {
    clock.wall += 1000;
    clock.perf += 1000;
    pool.pulse();
  }
}

function setup() {
  const { Ctor, made } = fakeProfiler();
  const logs: Record<string, unknown>[] = [];
  const shown = { now: true };
  // Garbage collection by hand: `collect()` collects every let-go profiler.
  let onCollected = (): void => undefined;
  const letGo: object[] = [];
  const pool = createProfilerPool({
    Profiler: Ctor,
    visible: () => shown.now,
    log: (l) => logs.push(l),
    registry: (cb) => {
      onCollected = cb;
      return { register: (t) => letGo.push(t) };
    },
  });
  const collect = (): void => {
    for (const _ of letGo.splice(0)) onCollected();
  };
  return { pool, made, logs, shown, collect };
}

describe("rolling over", () => {
  test("starts a profiler every 30 s and stops none", () => {
    const { pool, made, logs } = setup();
    run(pool, 200);
    expect(made.length).toBe(Math.floor(200 / 30) + 1);
    expect(made.filter((m) => m.stopped)).toHaveLength(0);
    expect(logs).toEqual([]);
  });

  test("let-go profilers are never stopped while they are collected", () => {
    const { pool, made, collect } = setup();
    for (let i = 0; i < 20; i++) {
      run(pool, 30);
      collect();
    }
    expect(made.filter((m) => m.stopped)).toHaveLength(0);
  });

  test("while let-go profilers are not collected, each roll-over builds the 30 s one it supersedes", () => {
    const { pool, made, logs } = setup();
    run(pool, 600); // no garbage collection at all
    const stopped = made.filter((m) => m.stopped);
    expect(stopped.length).toBeGreaterThan(0);
    // The steady state: exactly the profiler each roll-over superseded, so
    // the let-go count never passes the cap.
    const rollOvers = made.length - 1;
    expect(stopped.length).toBeLessThanOrEqual(rollOvers);
    expect(made.filter((m) => !m.stopped).length).toBeLessThanOrEqual(
      PROFILE.MAX_RELEASED + 1,
    );
    expect(logs.filter((l) => "releasedUncollected" in l)).toHaveLength(1);
  });
});

describe("evidence", () => {
  test("a window inside the current profiler stops exactly it, and sampling goes on", async () => {
    const { pool, made } = setup();
    run(pool, 40); // profilers at 1 s and 31 s
    const stacks = await pool.stacksIn({
      startedAt: asEpochMs(T0 + 35_000),
      endedAt: asEpochMs(T0 + 38_000),
    });
    expect(stacks.kind).toBe("sampled");
    if (stacks.kind !== "sampled") return;
    expect(stacks.stacks[0]?.frames[0]).toContain("spin");
    expect(stacks.sampledMs).toBe(3000);
    expect(made.map((m) => m.stopped)).toEqual([false, true, false]);
  });

  test("a window begun before the current profiler stops the standby that covers it", async () => {
    const { pool, made } = setup();
    run(pool, 40);
    const stacks = await pool.stacksIn({
      startedAt: asEpochMs(T0 + 20_000),
      endedAt: asEpochMs(T0 + 36_000),
    });
    expect(stacks.kind).toBe("sampled");
    if (stacks.kind !== "sampled") return;
    expect(stacks.sampledMs).toBe(16_000);
    expect(made.map((m) => m.stopped)).toEqual([true, false]);
  });

  test("a second report about the same moments reads the built trace again", async () => {
    const { pool, made } = setup();
    run(pool, 40);
    const window = {
      startedAt: asEpochMs(T0 + 35_000),
      endedAt: asEpochMs(T0 + 38_000),
    };
    await pool.stacksIn(window);
    const again = await pool.stacksIn(window);
    expect(again.kind).toBe("sampled");
    expect(made.filter((m) => m.stopped)).toHaveLength(1);
  });

  test("a window no profiler watched is unavailable, not empty", async () => {
    const { pool } = setup();
    run(pool, 10);
    const stacks = await pool.stacksIn({
      startedAt: asEpochMs(T0 - 5_000),
      endedAt: asEpochMs(T0 + 2_000),
    });
    expect(stacks.kind).toBe("unavailable");
  });
});

describe("past the cap", () => {
  test("a report on the current profiler builds it once and reads it", async () => {
    const { pool, made } = setup();
    run(pool, 400); // no garbage collection: past the cap
    const before = made.filter((m) => m.stopped).length;
    const stacks = await pool.stacksIn({
      startedAt: asEpochMs(T0 + 395_000),
      endedAt: asEpochMs(T0 + 398_000),
    });
    expect(stacks.kind).toBe("sampled");
    expect(made.filter((m) => m.stopped).length).toBe(before + 1);
  });
});

describe("hidden", () => {
  test("builds the oldest live profiler (covering every recent window) and lets the rest go", async () => {
    const { pool, made, shown } = setup();
    run(pool, 70); // profilers at 1 s, 31 s, 61 s
    shown.now = false;
    pool.visibility(false);
    expect(made.map((m) => m.stopped)).toEqual([true, false, false]);
    const stacks = await pool.stacksIn({
      startedAt: asEpochMs(T0 + 50_000),
      endedAt: asEpochMs(T0 + 65_000),
    });
    expect(stacks.kind).toBe("sampled");
    if (stacks.kind === "sampled") expect(stacks.sampledMs).toBe(15_000);
    // Nothing samples while hidden.
    run(pool, 5);
    expect(made).toHaveLength(3);
  });

  test("a window after an earlier report's built trace is still covered once hidden", async () => {
    const { pool, shown } = setup();
    run(pool, 45); // profilers at 1 s (standby) and 31 s (current)
    // A slow interaction at 40 s builds the current one (31–45 s).
    await pool.stacksIn({
      startedAt: asEpochMs(T0 + 40_000),
      endedAt: asEpochMs(T0 + 42_000),
    });
    run(pool, 5); // a stall 46–49 s, then the tab is hidden before it is filed
    shown.now = false;
    pool.visibility(false);
    const stacks = await pool.stacksIn({
      startedAt: asEpochMs(T0 + 36_000),
      endedAt: asEpochMs(T0 + 49_000),
    });
    expect(stacks.kind).toBe("sampled");
    if (stacks.kind === "sampled") expect(stacks.sampledMs).toBe(13_000);
  });

  test("an oldest profiler whose buffer filled is built with the one after it", async () => {
    const { pool, made, shown } = setup();
    run(pool, 20); // profiler at 1 s
    made[0]!.fill(); // a long freeze spent its buffer: the next one starts
    run(pool, 5);
    expect(made).toHaveLength(2);
    shown.now = false;
    pool.visibility(false);
    expect(made.map((m) => m.stopped)).toEqual([true, true]);
  });
});
