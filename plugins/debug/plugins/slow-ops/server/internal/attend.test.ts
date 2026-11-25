import { describe, expect, test } from "bun:test";
import { attend, type UnattendedClock } from "./attend";
import type { RecordSlowOpInput } from "./input";

const END = 1_000_000;

function input(over: Partial<RecordSlowOpInput> = {}): RecordSlowOpInput {
  return {
    timing: { clock: "awake", endedAtMs: END },
    operationKind: "wait",
    operation: "spawn:gh",
    durationMs: 30_000,
    ownMs: 30_000,
    thresholdMs: 2_000,
    source: "server-slow-op",
    ...over,
  };
}

function clock(over: Partial<UnattendedClock> = {}): UnattendedClock {
  return {
    sleptDuring: () => 0,
    darkWakeDuring: () => 0,
    awakeSpanStart: (end, awake) => end - awake,
    ...over,
  };
}

describe("attend", () => {
  test("a server wait spent in dark wakes is judged on what is left", () => {
    // report-1795262994-kykxrk: 30 s of `gh` across six dark wakes, the last
    // 3.7 s of it after the final one — 26.3 s dark, the rest in a full wake.
    const asked: [number, number][] = [];
    const out = attend(
      input(),
      clock({
        // The wait's 30 s of awake time stepped over a 10 min nap.
        awakeSpanStart: (end) => end - 630_000,
        darkWakeDuring: (s, e) => {
          asked.push([s, e]);
          return 26_300;
        },
      }),
    );
    expect(asked).toEqual([[END - 630_000, END]]);
    expect(out.ownMs).toBe(3_700);
    expect(out.waits).toEqual({ "dark-wake": 26_300 });
    expect(out.timing).toEqual({ clock: "attended" });
  });

  test("the awake clock has no sleep to take off: only dark wakes", () => {
    let askedSleep = false;
    const out = attend(
      input(),
      clock({
        sleptDuring: () => {
          askedSleep = true;
          return 600_000;
        },
      }),
    );
    expect(askedSleep).toBe(false);
    expect(out.ownMs).toBe(30_000);
  });

  test("dark time already excluded as waits is not taken off twice", () => {
    // A span of 10 s, 6 s of it a gate wait (the gate's), 7 s in a dark wake:
    // only the 1 s beyond the excluded part comes off its own 4 s.
    const out = attend(
      input({ operationKind: "loader", durationMs: 10_000, ownMs: 4_000 }),
      clock({ darkWakeDuring: () => 7_000 }),
    );
    expect(out.ownMs).toBe(3_000);
  });

  test("a wall-clock item loses its sleep and dark wakes beyond its hidden time", () => {
    const out = attend(
      input({
        timing: { clock: "wall", endedAtMs: END },
        operationKind: "update",
        durationMs: 120_000,
        ownMs: 30_000,
        waits: { "page-hidden": 90_000 },
      }),
      clock({ sleptDuring: () => 95_000, darkWakeDuring: () => 5_000 }),
    );
    // 100 s unattended, 90 s already off as hidden: 10 s more comes off.
    expect(out.ownMs).toBe(20_000);
    expect(out.waits).toEqual({
      "page-hidden": 90_000,
      sleep: 95_000,
      "dark-wake": 5_000,
    });
  });

  test("a wall window is the duration itself", () => {
    const asked: [number, number][] = [];
    attend(
      input({ timing: { clock: "wall", endedAtMs: END }, durationMs: 120_000 }),
      clock({
        awakeSpanStart: () => {
          throw new Error("not asked on the wall clock");
        },
        sleptDuring: (s, e) => {
          asked.push([s, e]);
          return 0;
        },
      }),
    );
    expect(asked).toEqual([[880_000, END]]);
  });

  test("attended once: a second pass takes nothing off", () => {
    const once = attend(input(), clock({ darkWakeDuring: () => 26_300 }));
    expect(attend(once, clock({ darkWakeDuring: () => 26_300 }))).toBe(once);
  });

  test("cannot tell, nothing unattended, or no end instant: own time unchanged", () => {
    const unknown = attend(
      input(),
      clock({ darkWakeDuring: () => null, sleptDuring: () => null }),
    );
    expect(unknown.ownMs).toBe(30_000);
    expect(unknown.waits).toBeUndefined();
    const unplaced = attend(
      input({ timing: { clock: "unplaced" } }),
      clock({ darkWakeDuring: () => 26_300 }),
    );
    expect(unplaced.ownMs).toBe(30_000);
    expect(unplaced.timing).toEqual({ clock: "attended" });
  });
});
