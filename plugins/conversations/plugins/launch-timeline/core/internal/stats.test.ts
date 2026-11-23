import { describe, expect, test } from "bun:test";
import {
  clockStamp,
  type ClockStamp,
} from "@plugins/packages/plugins/sleep-clock/plugins/stamp/core";
import { CheckoutStepSchema, LaunchMarksSchema } from "./schemas";
import { checkoutStepStats, percentiles, segmentStats } from "./stats";
import type { LaunchSample } from "./stats";

const T0 = Date.UTC(2026, 10, 18, 12);

/** An instant `ms` after T0, the machine having slept `asleepMs` by then. */
function at(ms: number, asleepMs: number | null = 0): ClockStamp {
  return clockStamp(
    T0 + ms,
    asleepMs === null ? null : { boot: "B", asleepMs },
  );
}

function launch(
  marks: LaunchSample["marks"],
  steps: LaunchSample["checkoutSteps"] = [],
): LaunchSample {
  return {
    requestedAt: new Date(T0),
    marks: { requested: at(0), ...marks },
    checkoutSteps: steps,
    checkoutSource: null,
  };
}

describe("percentiles", () => {
  test("nearest rank", () => {
    expect(percentiles([5, 1, 4, 2, 3, 6, 7, 8, 9, 10])).toEqual({
      n: 10,
      p50: 5,
      p90: 9,
    });
    expect(percentiles([7])).toEqual({ n: 1, p50: 7, p90: 7 });
  });
  test("no value is no percentile, not zero", () => {
    expect(percentiles([])).toEqual({ n: 0, p50: null, p90: null });
  });
});

describe("segmentStats", () => {
  test("a stretch counts only launches that reached both ends", () => {
    const stats = segmentStats([
      launch({ "spawn-started": at(100), "agent-started": at(9000) }),
      launch({ "spawn-started": at(300) }),
    ]);
    const byId = new Map(stats.map((s) => [s.id, s]));
    expect(byId.get("queue")).toMatchObject({ n: 2, p50: 100, p90: 300 });
    expect(byId.get("to-agent")).toMatchObject({ n: 1, p50: 9000 });
    expect(byId.get("cli-init")).toMatchObject({ n: 0, p50: null });
  });
  test("a reordered phase reads as a negative stretch, the totals still hold", () => {
    // The agent started before the checkout ended (started while installing).
    const [handOff] = segmentStats([
      launch({ "prepare-ended": at(5000), "agent-started": at(3000) }),
    ]).filter((s) => s.id === "hand-off");
    expect(handOff!.p50).toBe(-2000);
  });
  test("a reordered stretch with a nap between its ends takes the nap out too", () => {
    // The agent started, the machine slept 1 h, the checkout ended after it.
    const [handOff] = segmentStats([
      launch({
        "agent-started": at(1_000),
        "prepare-ended": at(3_603_000, 3_600_000),
      }),
    ]).filter((s) => s.id === "hand-off");
    expect(handOff).toMatchObject({ p50: -2_000, slept: 1 });
  });
  test("a sleep inside a stretch is taken out, and counted", () => {
    // 2026-11-21 17:32: 7320 s on the wall to the first token, 110 s awake.
    const [toFirstToken] = segmentStats([
      launch({
        "cli-ready": at(20_000),
        "first-token": at(7_320_000, 7_210_000),
      }),
    ]).filter((s) => s.id === "to-first-token");
    expect(toFirstToken).toMatchObject({
      p50: 110_000,
      slept: 1,
      untold: 0,
    });
  });
  test("a stretch whose sleep cannot be told reads as wall time, and says so", () => {
    // A record from before stamps: wall instants only, no `requested` stamp.
    const legacy: LaunchSample = {
      requestedAt: new Date(T0),
      marks: { "spawn-started": at(400, null) },
      checkoutSteps: [],
      checkoutSource: null,
    };
    const [queue] = segmentStats([legacy]).filter((s) => s.id === "queue");
    expect(queue).toMatchObject({ p50: 400, slept: 0, untold: 1 });
  });
});

describe("stored shapes", () => {
  test("a bare wall instant from the old writers reads as an untold stamp", () => {
    expect(LaunchMarksSchema.parse({ "spawn-started": T0 })).toEqual({
      "spawn-started": clockStamp(T0, null),
    });
    expect(
      CheckoutStepSchema.parse({ step: "install", ms: 5, endAt: T0 }),
    ).toEqual({ step: "install", ms: 5, end: clockStamp(T0, null) });
  });
  test("a stamp reads as itself", () => {
    expect(LaunchMarksSchema.parse({ requested: at(3, 9) })).toEqual({
      requested: at(3, 9),
    });
  });
});

describe("checkoutStepStats", () => {
  test("a step run twice in one checkout counts its sum", () => {
    const stats = checkoutStepStats([
      launch({}, [
        { step: "gate-wait", ms: 10, end: at(0) },
        { step: "install", ms: 900, end: at(0) },
        { step: "gate-wait", ms: 30, end: at(0) },
      ]),
      launch({}, [{ step: "install", ms: 1100, end: at(0) }]),
    ]);
    expect(stats).toEqual([
      { step: "gate-wait", n: 1, p50: 40, p90: 40 },
      { step: "install", n: 2, p50: 900, p90: 1100 },
    ]);
  });
});
