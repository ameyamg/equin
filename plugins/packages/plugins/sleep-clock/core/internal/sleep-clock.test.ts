import { describe, expect, test } from "bun:test";
import {
  createSleepMeter,
  processStartStamp,
  readAwakeClock,
  readSleepClock,
} from "./sleep-clock";

describe.if(process.platform === "darwin")("readSleepClock (darwin)", () => {
  test("reads a boot session, a cumulative sleep and the last wake", () => {
    const a = readSleepClock();
    const b = readSleepClock();
    if (!a.supported || !b.supported)
      throw new Error("expected support on darwin");
    expect(a.boot).toMatch(/^[0-9A-F-]{36}$/);
    expect(b.boot).toBe(a.boot);
    expect(a.asleepMs).toBeGreaterThanOrEqual(0);
    // Cumulative since boot: never goes backwards (modulo the ns-level read skew).
    expect(b.asleepMs).toBeGreaterThanOrEqual(a.asleepMs - 0.01);
    if (a.wakeAtMs !== null) {
      expect(a.wakeAtMs).toBeGreaterThan(0);
      expect(a.wakeAtMs).toBeLessThanOrEqual(Date.now());
    }
  });

  test("the process's start stamp is at its start, no later than now", () => {
    const start = processStartStamp();
    const now = readSleepClock();
    if (!now.supported || start.sleep === null)
      throw new Error("expected support on darwin");
    expect(start.wallMs).toBe(Math.round(performance.timeOrigin));
    expect(start.sleep.boot).toBe(now.boot);
    expect(start.sleep.asleepMs).toBeLessThanOrEqual(now.asleepMs + 1);
  });

  test("a meter over an awake window reports no sleep", () => {
    const meter = createSleepMeter();
    const r = meter.read();
    if (!r.supported) throw new Error("expected support on darwin");
    expect(r.sleptMs).toBeGreaterThanOrEqual(0);
    expect(r.sleptMs).toBeLessThan(1);
  });
});

describe.if(process.platform !== "darwin")("readSleepClock (elsewhere)", () => {
  test("says it cannot tell", () => {
    expect(readSleepClock()).toEqual({ supported: false });
  });
});

describe.if(process.platform === "darwin")("readAwakeClock (darwin)", () => {
  test("advances with awake time", async () => {
    const a = readAwakeClock();
    await new Promise((r) => setTimeout(r, 20));
    const b = readAwakeClock();
    if (!a.supported || !b.supported)
      throw new Error("expected support on darwin");
    expect(b.awakeMs - a.awakeMs).toBeGreaterThanOrEqual(15);
  });
});
