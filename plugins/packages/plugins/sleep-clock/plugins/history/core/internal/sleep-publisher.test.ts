import { describe, expect, test } from "bun:test";
import type { SleepClockReading } from "./sleep-publisher";
import {
  awakeSpanStartMs,
  createSleepPublisher,
  lastSleepOf,
  overlapMs,
  sleepBetween,
  sleepNowChanged,
  wakeWithin,
} from "./sleep-publisher";

const BOOT = "B25F1FC6-798F-412D-B0DA-B41350248582";

function harness(first: SleepClockReading) {
  let reading = first;
  let notified = 0;
  const p = createSleepPublisher(() => reading);
  p.subscribe(() => notified++);
  return {
    p,
    set: (r: SleepClockReading) => (reading = r),
    notified: () => notified,
  };
}

describe("createSleepPublisher", () => {
  test("publishes the first reading, then only when it changes", () => {
    const h = harness({
      supported: true,
      boot: BOOT,
      asleepMs: 1000,
      wakeAtMs: 5,
      sleepAtMs: null,
      atMs: 0,
      darkWake: null,
    });
    h.p.publish();
    expect(h.notified()).toBe(1);
    expect(h.p.current()).toEqual({ boot: BOOT, asleepMs: 1000, wakeAtMs: 5 });

    // Same reading (modulo sub-ms read jitter): no push.
    h.set({
      supported: true,
      boot: BOOT,
      asleepMs: 1000.0004,
      wakeAtMs: 5,
      sleepAtMs: null,
      atMs: 0,
      darkWake: null,
    });
    h.p.publish();
    h.p.publish();
    expect(h.notified()).toBe(1);
    expect(h.p.current()?.asleepMs).toBe(1000);

    // A wake: more sleep and a new waketime.
    h.set({
      supported: true,
      boot: BOOT,
      asleepMs: 61_000,
      wakeAtMs: 90_000,
      sleepAtMs: null,
      atMs: 0,
      darkWake: null,
    });
    h.p.publish();
    expect(h.notified()).toBe(2);
    expect(h.p.current()).toEqual({
      boot: BOOT,
      asleepMs: 61_000,
      wakeAtMs: 90_000,
    });
  });

  test("current() before any publish reads the clock without pushing", () => {
    const h = harness({ supported: false });
    expect(h.p.current()).toBeNull();
    expect(h.notified()).toBe(0);
    // The loader's read counts as the baseline: an unchanged publish is silent.
    h.p.publish();
    expect(h.notified()).toBe(0);
  });

  test("an unsubscribed listener hears nothing more", () => {
    const h = harness({
      supported: true,
      boot: BOOT,
      asleepMs: 0,
      wakeAtMs: 1,
      sleepAtMs: null,
      atMs: 0,
      darkWake: null,
    });
    let other = 0;
    const stop = h.p.subscribe(() => other++);
    h.p.publish();
    expect(other).toBe(1);
    stop();
    h.set({
      supported: true,
      boot: BOOT,
      asleepMs: 5_000,
      wakeAtMs: 2,
      sleepAtMs: null,
      atMs: 0,
      darkWake: null,
    });
    h.p.publish();
    expect(other).toBe(1);
    expect(h.notified()).toBe(2);
  });
});

describe("sleepNowChanged", () => {
  const base = { boot: BOOT, asleepMs: 10, wakeAtMs: null };
  test("unsupported vs supported", () => {
    expect(sleepNowChanged(null, null)).toBe(false);
    expect(sleepNowChanged(null, base)).toBe(true);
    expect(sleepNowChanged(base, null)).toBe(true);
  });
  test("a new boot, a new wake, or a millisecond more sleep", () => {
    expect(sleepNowChanged(base, { ...base, boot: "other" })).toBe(true);
    expect(sleepNowChanged(base, { ...base, wakeAtMs: 1 })).toBe(true);
    expect(sleepNowChanged(base, { ...base, asleepMs: 11 })).toBe(true);
    expect(sleepNowChanged(base, { ...base, asleepMs: 10.5 })).toBe(false);
  });
});

describe("sleptDuring", () => {
  test("places each sleep a reading reveals at its wake, and overlaps spans with it", () => {
    const h = harness({
      supported: true,
      boot: BOOT,
      asleepMs: 0,
      wakeAtMs: null,
      sleepAtMs: null,
      atMs: 0,
      darkWake: null,
    });
    h.p.publish();
    // 60 s of sleep, ended by the wake at t=100 000.
    h.set({
      supported: true,
      boot: BOOT,
      asleepMs: 60_000,
      wakeAtMs: 100_000,
      sleepAtMs: null,
      atMs: 0,
      darkWake: null,
    });
    expect(h.p.sleptDuring(0, 200_000)).toBe(60_000);
    expect(h.p.sleptDuring(90_000, 200_000)).toBe(10_000);
    expect(h.p.sleptDuring(100_000, 200_000)).toBe(0);
  });

  test("cannot tell where the platform has no clock", () => {
    const h = harness({ supported: false });
    expect(h.p.sleptDuring(0, 1)).toBeNull();
  });

  test("a new boot places nothing", () => {
    expect(
      sleepBetween(
        { boot: "a", asleepMs: 0, wakeAtMs: null },
        { boot: "b", asleepMs: 5000, wakeAtMs: 10 },
      ),
    ).toBeNull();
  });

  test("overlapMs unions the sleeps", () => {
    expect(
      overlapMs(
        [
          { startMs: 0, endMs: 10 },
          { startMs: 5, endMs: 20 },
        ],
        0,
        100,
      ),
    ).toBe(20);
  });
});

describe("awakeSpanStart", () => {
  test("no sleep in reach: the plain wall-clock span", () => {
    expect(awakeSpanStartMs([], 100_000, 30_000)).toBe(70_000);
    expect(
      awakeSpanStartMs([{ startMs: 0, endMs: 10_000 }], 100_000, 30_000),
    ).toBe(70_000);
  });

  test("steps over a sleep inside the span (the 2026-11-14 sweep)", () => {
    // Locked at t=0, 4 s before a 262 s sleep, swept the moment it woke: 266 s
    // of wall clock, only 4 s of awake time — the grace starts before the lock.
    const sleeps = [{ startMs: 4_000, endMs: 266_000 }];
    expect(awakeSpanStartMs(sleeps, 266_000, 30_000)).toBe(-26_000);
  });

  test("steps over several sleeps, overlapping ones together", () => {
    const sleeps = [
      { startMs: 50, endMs: 60 },
      { startMs: 80, endMs: 95 },
      { startMs: 85, endMs: 90 },
    ];
    // awake 95→100 (5), 60→80 (20), then 5 more before 50.
    expect(awakeSpanStartMs(sleeps, 100, 30)).toBe(45);
  });

  test("ignores sleeps that start after the end", () => {
    expect(awakeSpanStartMs([{ startMs: 200, endMs: 300 }], 100, 30)).toBe(70);
  });

  test("the publisher reads the clock first and says when it cannot tell", () => {
    const h = harness({
      supported: true,
      boot: BOOT,
      asleepMs: 0,
      wakeAtMs: null,
      sleepAtMs: null,
      atMs: 0,
      darkWake: null,
    });
    h.p.publish();
    h.set({
      supported: true,
      boot: BOOT,
      asleepMs: 60_000,
      wakeAtMs: 100_000,
      sleepAtMs: null,
      atMs: 0,
      darkWake: null,
    });
    expect(h.p.awakeSpanStart(110_000, 30_000)).toBe(20_000);
    expect(harness({ supported: false }).p.awakeSpanStart(1, 1)).toBeNull();
  });
});

describe("wakeBefore", () => {
  test("the latest sleep ending in the window before the instant", () => {
    const sleeps = [
      { startMs: 0, endMs: 1_000 },
      { startMs: 2_000, endMs: 270_000 },
    ];
    // The 2026-11-14 incident: reports in the second after a 268 s sleep.
    expect(wakeWithin(sleeps, 270_400, 30_000)).toEqual(sleeps[1]!);
    // Long after the wake, or before it: not "just woke".
    expect(wakeWithin(sleeps, 400_000, 30_000)).toBeNull();
    expect(wakeWithin(sleeps, 269_000, 30_000)).toBeNull();
  });

  test("the publisher reads the clock first and says when it cannot tell", () => {
    const h = harness({
      supported: true,
      boot: BOOT,
      asleepMs: 0,
      wakeAtMs: null,
      sleepAtMs: null,
      atMs: 0,
      darkWake: null,
    });
    h.p.publish();
    h.set({
      supported: true,
      boot: BOOT,
      asleepMs: 268_000,
      wakeAtMs: 300_000,
      sleepAtMs: null,
      atMs: 0,
      darkWake: null,
    });
    expect(h.p.wakeBefore(300_500, 30_000)).toEqual({
      supported: true,
      sleep: { startMs: 32_000, endMs: 300_000 },
    });
    expect(h.p.wakeBefore(400_000, 30_000)).toEqual({
      supported: true,
      sleep: null,
    });
    expect(harness({ supported: false }).p.wakeBefore(1, 1)).toEqual({
      supported: false,
    });
  });
});

describe("a process started after a wake", () => {
  // The queue-health gap (2026-11-20): a backend booted on the wake had no
  // previous reading to diff, placed no sleep, and judged the nap on the wall
  // clock. The clock's own last sleep (kern.sleeptime → kern.waketime) places it.
  const woke = {
    supported: true as const,
    boot: BOOT,
    asleepMs: 2_000_000,
    sleepAtMs: 1_000_000,
    atMs: 0,
    darkWake: null,
    wakeAtMs: 1_961_000,
  };

  test("places the sleep before its first reading", () => {
    const p = createSleepPublisher(() => woke);
    expect(p.sleptDuring(900_000, 2_000_000)).toBe(961_000);
    expect(p.wakeBefore(1_961_400, 30_000)).toEqual({
      supported: true,
      sleep: { startMs: 1_000_000, endMs: 1_961_000 },
    });
  });

  test("current() as the first read places it too, without pushing", () => {
    let notified = 0;
    const p = createSleepPublisher(() => woke);
    p.subscribe(() => notified++);
    p.current();
    expect(notified).toBe(0);
    expect(p.sleptDuring(900_000, 2_000_000)).toBe(961_000);
  });

  test("an awake span of a process that never saw a sleep stays whole", () => {
    const p = createSleepPublisher(() => woke);
    expect(p.sleptDuring(1_970_000, 2_030_000)).toBe(0);
  });

  test("places nothing the pair does not bound", () => {
    // Asleep again since the last wake (read mid dark-wake), never slept, or unreadable.
    expect(lastSleepOf({ ...woke, sleepAtMs: 1_962_000 })).toBeNull();
    expect(lastSleepOf({ ...woke, sleepAtMs: null })).toBeNull();
    expect(lastSleepOf({ ...woke, wakeAtMs: null })).toBeNull();
    expect(lastSleepOf({ supported: false })).toBeNull();
  });
});

describe("the query gate", () => {
  test("a query reads the clock only when a sleep may have happened", () => {
    let reads = 0;
    let gate = false;
    const p = createSleepPublisher(
      () => {
        reads++;
        return {
          supported: true,
          boot: BOOT,
          asleepMs: 0,
          wakeAtMs: null,
          sleepAtMs: null,
          atMs: 0,
          darkWake: null,
        };
      },
      () => gate,
    );
    p.sleptDuring(0, 1); // first query: nothing read yet, reads
    p.sleptDuring(0, 1);
    p.awakeSpanStart(1, 1);
    expect(reads).toBe(1);
    gate = true;
    p.wakeBefore(1, 1);
    expect(reads).toBe(2);
    p.publish(); // a publish always reads
    expect(reads).toBe(3);
  });
});

describe("dark wakes", () => {
  // A lid-shut Mac: naps of ~10 min, each ended by a dark wake of a few
  // seconds (the 2026-11-25 power log: 09:52:18 → 09:52:20, 10:02:46 → 10:02:54).
  const reading = (
    asleepMs: number,
    wakeAtMs: number | null,
    atMs: number,
    darkWake: boolean | null,
  ): SleepClockReading => ({
    supported: true,
    boot: BOOT,
    asleepMs,
    wakeAtMs,
    sleepAtMs: null,
    atMs,
    darkWake,
  });

  function lidShut() {
    let r = reading(0, null, 1_000_000, false);
    const p = createSleepPublisher(() => r);
    return { p, set: (next: SleepClockReading) => (r = next) };
  }

  test("a span across naps and dark wakes: the naps are sleep, the dark wakes dark", () => {
    const { p, set } = lidShut();
    p.publish();
    // Awake until 1_010_000, asleep 600 s, dark wake at 1_610_000 read twice.
    set(reading(600_000, 1_610_000, 1_610_500, true));
    p.publish();
    set(reading(600_000, 1_610_000, 1_613_000, true));
    p.publish();
    // Asleep again from 1_614_000 for 300 s; dark wake at 1_914_000.
    set(reading(900_000, 1_914_000, 1_914_400, true));
    p.publish();
    // The first dark stretch runs from its wake to the sleep that ended it.
    expect(p.darkWakeDuring(1_610_000, 1_614_000)).toBe(4_000);
    // A query reads while the wake is dark: the open stretch reaches it.
    set(reading(900_000, 1_914_000, 1_918_000, true));
    expect(p.darkWakeDuring(1_000_000, 1_918_000)).toBe(8_000);
    expect(p.sleptDuring(1_000_000, 1_918_000)).toBe(900_000);
  });

  test("a dark wake that turns full stops at its last dark reading", () => {
    const { p, set } = lidShut();
    p.publish();
    set(reading(600_000, 1_610_000, 1_612_000, true));
    p.publish();
    // The lid opens: same wake, full capabilities.
    set(reading(600_000, 1_610_000, 1_620_000, false));
    expect(p.darkWakeDuring(1_600_000, 1_700_000)).toBe(2_000);
    // A later sleep does not reopen it.
    set(reading(700_000, 1_800_000, 1_800_100, false));
    p.publish();
    expect(p.darkWakeDuring(1_600_000, 1_900_000)).toBe(2_000);
  });

  test("a full wake that turns dark is dark only from its last full reading", () => {
    const { p, set } = lidShut();
    p.publish();
    set(reading(600_000, 1_610_000, 1_611_000, false));
    p.publish();
    // Hours later, same wake: the graphics went off (a sleep entry's first step).
    set(reading(600_000, 1_610_000, 9_000_000, false));
    p.publish();
    set(reading(600_000, 1_610_000, 9_002_000, true));
    expect(p.darkWakeDuring(1_610_000, 9_002_000)).toBe(2_000);
  });

  test("a process's first reading in a dark wake counts nothing before it", () => {
    const p = createSleepPublisher(() =>
      reading(600_000, 1_610_000, 1_615_000, true),
    );
    expect(p.darkWakeDuring(1_000_000, 1_615_000)).toBe(0);
  });

  test("a full wake is no dark time", () => {
    const { p, set } = lidShut();
    p.publish();
    set(reading(600_000, 1_610_000, 1_610_500, false));
    p.publish();
    expect(p.darkWakeDuring(1_000_000, 1_700_000)).toBe(0);
  });

  test("cannot tell: null, never 'fully awake'", () => {
    const p = createSleepPublisher(() => reading(0, null, 1_000_000, null));
    expect(p.darkWakeDuring(0, 2_000_000)).toBeNull();
    const off = createSleepPublisher(() => ({ supported: false }));
    expect(off.darkWakeDuring(0, 2_000_000)).toBeNull();
  });
});
