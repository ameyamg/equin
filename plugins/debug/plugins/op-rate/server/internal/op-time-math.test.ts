import { expect, test, describe } from "bun:test";
import {
  windowDelta,
  computeRollup,
  gateTrips,
  type GateBaseline,
} from "./op-time-math";

describe("windowDelta", () => {
  test("first observation seeds (returns null, fires nothing)", () => {
    expect(windowDelta(undefined, 5000)).toBeNull();
  });

  test("monotonic growth returns the difference", () => {
    expect(windowDelta(1000, 3500)).toBe(2500);
  });

  test("no change returns zero", () => {
    expect(windowDelta(4200, 4200)).toBe(0);
  });

  test("reset/regression takes the full current value as the delta", () => {
    // Profile was reset (or the label is new this tick) so `current < prev`.
    expect(windowDelta(9000, 1200)).toBe(1200);
  });

  test("zero current after a reset is zero, not negative", () => {
    expect(windowDelta(9000, 0)).toBe(0);
  });
});

describe("computeRollup", () => {
  test("under budget returns null", () => {
    const deltas = [
      { label: "a", deltaMs: 10000 },
      { label: "b", deltaMs: 20000 },
    ];
    // sum 30000 <= 60000*1
    expect(computeRollup(deltas, 60000, 1)).toBeNull();
  });

  test("exactly at budget does not trip (strict >)", () => {
    const deltas = [{ label: "a", deltaMs: 40000 }];
    expect(computeRollup(deltas, 10000, 4)).toBeNull();
  });

  test("over budget trips and reports the sum and rollup budget", () => {
    const deltas = [
      { label: "a", deltaMs: 30000 },
      { label: "b", deltaMs: 25000 },
    ];
    const breach = computeRollup(deltas, 10000, 4);
    expect(breach).not.toBeNull();
    expect(breach!.sumDeltaMs).toBe(55000);
    expect(breach!.rollupBudgetMs).toBe(40000);
  });

  test("topLabels are sorted by delta desc and capped at 10", () => {
    const deltas = Array.from({ length: 15 }, (_, i) => ({
      label: `l${i}`,
      deltaMs: (i + 1) * 1000,
    }));
    const breach = computeRollup(deltas, 1000, 1);
    expect(breach).not.toBeNull();
    expect(breach!.topLabels).toHaveLength(10);
    expect(breach!.topLabels[0]).toEqual({ label: "l14", deltaMs: 15000 });
    expect(breach!.topLabels[9]).toEqual({ label: "l5", deltaMs: 6000 });
  });

  test("empty deltas never trip", () => {
    expect(computeRollup([], 0, 4)).toBeNull();
  });
});

describe("gateTrips", () => {
  // A queue gate: its union is irrelevant to the judgment, so pin it to 0.
  const read = (layer: string, count: number, totalMs: number) => ({
    layer,
    kind: "queue" as const,
    count,
    totalMs,
    busyTotalMs: 0,
  });
  const io = (
    layer: string,
    count: number,
    totalMs: number,
    busyTotalMs: number,
  ) => ({ layer, kind: "io" as const, count, totalMs, busyTotalMs });

  test("a gate seen for the first time seeds and trips nothing", () => {
    const baseline: GateBaseline = new Map();
    expect(
      gateTrips([read("read-admit", 900, 500_000)], baseline, 60_000),
    ).toEqual([]);
    expect(baseline.get("read-admit")).toEqual({
      count: 900,
      totalMs: 500_000,
      busyTotalMs: 0,
    });
  });

  test("trips a queue gate whose waiters waited past the budget in total, and only that one", () => {
    const baseline: GateBaseline = new Map([
      ["read-admit", { count: 100, totalMs: 10_000, busyTotalMs: 0 }],
      ["db-acquire", { count: 5000, totalMs: 2_000, busyTotalMs: 0 }],
    ]);
    const trips = gateTrips(
      [read("read-admit", 400, 85_000), read("db-acquire", 9000, 4_000)],
      baseline,
      60_000,
    );
    expect(trips).toEqual([
      {
        layer: "read-admit",
        kind: "queue",
        msDelta: 75_000,
        summedMsDelta: 75_000,
        waitsDelta: 300,
      },
    ]);
    // The baseline holds this tick's readings for the next.
    expect(baseline.get("db-acquire")).toEqual({
      count: 9000,
      totalMs: 4_000,
      busyTotalMs: 0,
    });
  });

  test("an io layer is judged on the wall time its work was outstanding, not the sum", () => {
    // Main, 11:00 UTC 2026-11-23: one healthy fsmonitor pass, 78 git children
    // four at a time — 75.9 s summed, 19.7 s of wall. Not a trip.
    const healthy: GateBaseline = new Map([
      ["spawn:git", { count: 1000, totalMs: 500_000, busyTotalMs: 200_000 }],
    ]);
    expect(
      gateTrips([io("spawn:git", 1078, 575_900, 219_700)], healthy, 60_000),
    ).toEqual([]);
    // 2026-11-22 07:03: overlapping passes kept git running ≥ 116.7 s of the
    // window (300 s summed). Still a trip, on the union.
    const overlapping: GateBaseline = new Map([
      ["spawn:git", { count: 0, totalMs: 0, busyTotalMs: 0 }],
    ]);
    expect(
      gateTrips([io("spawn:git", 200, 300_000, 116_700)], overlapping, 60_000),
    ).toEqual([
      {
        layer: "spawn:git",
        kind: "io",
        msDelta: 116_700,
        summedMsDelta: 300_000,
        waitsDelta: 200,
      },
    ]);
  });

  test("a reset is decided once, from the count, for the sum and the union alike", () => {
    // After a reset the new union (60 s) is above its old baseline (50 s):
    // judged on its own it would read as a 10 s gain.
    const baseline: GateBaseline = new Map([
      ["spawn:git", { count: 500, totalMs: 100_000, busyTotalMs: 50_000 }],
    ]);
    expect(
      gateTrips([io("spawn:git", 80, 80_000, 60_000)], baseline, 55_000),
    ).toEqual([
      {
        layer: "spawn:git",
        kind: "io",
        msDelta: 60_000,
        summedMsDelta: 80_000,
        waitsDelta: 80,
      },
    ]);
  });

  test("at the budget exactly is not a trip; a reset takes the whole reading", () => {
    const baseline: GateBaseline = new Map([
      ["g", { count: 10, totalMs: 1_000, busyTotalMs: 0 }],
    ]);
    expect(gateTrips([read("g", 20, 61_000)], baseline, 60_000)).toEqual([]);
    // Profile reset: the count fell — the whole reading is the window.
    const after: GateBaseline = new Map([
      ["g", { count: 10, totalMs: 90_000, busyTotalMs: 0 }],
    ]);
    expect(gateTrips([read("g", 3, 70_000)], after, 60_000)).toEqual([
      {
        layer: "g",
        kind: "queue",
        msDelta: 70_000,
        summedMsDelta: 70_000,
        waitsDelta: 3,
      },
    ]);
  });
});
