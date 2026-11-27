import { describe, expect, test } from "bun:test";
import { createQuotaPacer, type PacerClock } from "./pacer";

/** A clock whose timers fire only when the test advances it. */
function fakeClock() {
  let now = 0;
  let next = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: PacerClock = {
    now: () => now,
    setTimeout(fn, ms) {
      const id = next++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
  };
  return {
    clock,
    timers: () => timers.size,
    async advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
        await Promise.resolve();
      }
      now = until;
      await Promise.resolve();
    },
  };
}

/** Tracks which acquisitions have resolved. */
function track(p: Promise<void>) {
  const s = { done: false };
  void p.then(() => (s.done = true));
  return s;
}

describe("createQuotaPacer", () => {
  test("admits at once while the window has room", async () => {
    const c = fakeClock();
    const pacer = createQuotaPacer({ unitsPerMinute: 100, clock: c.clock });
    await pacer.acquire(60, { priority: "foreground" });
    await pacer.acquire(40, { priority: "foreground" });
    expect(pacer.stats().windowUnits).toBe(100);
    expect(c.timers()).toBe(0);
  });

  test("a call past the window waits until the oldest charge leaves it", async () => {
    const c = fakeClock();
    const pacer = createQuotaPacer({ unitsPerMinute: 100, clock: c.clock });
    await pacer.acquire(60, { priority: "foreground" });
    await c.advance(10_000);
    await pacer.acquire(40, { priority: "foreground" });
    const third = track(pacer.acquire(50, { priority: "foreground" }));
    await c.advance(49_999);
    expect(third.done).toBe(false);
    await c.advance(1); // t = 60 s: the 60-unit charge leaves
    expect(third.done).toBe(true);
    expect(pacer.stats().windowUnits).toBe(90);
    expect(pacer.stats().spentUnits).toBe(150);
  });

  test("foreground is admitted before background, whatever the arrival order", async () => {
    const c = fakeClock();
    const pacer = createQuotaPacer({
      unitsPerMinute: 100,
      backgroundShare: 1,
      clock: c.clock,
    });
    await pacer.acquire(100, { priority: "foreground" });
    const order: string[] = [];
    void pacer
      .acquire(50, { priority: "background" })
      .then(() => order.push("bg"));
    void pacer
      .acquire(50, { priority: "foreground" })
      .then(() => order.push("fg"));
    await c.advance(60_000);
    expect(order).toEqual(["fg", "bg"]);
  });

  test("background fills only its share, keeping room for a click", async () => {
    const c = fakeClock();
    const pacer = createQuotaPacer({
      unitsPerMinute: 100,
      backgroundShare: 0.5,
      clock: c.clock,
    });
    await pacer.acquire(50, { priority: "background" });
    const bg = track(pacer.acquire(10, { priority: "background" }));
    await Promise.resolve();
    expect(bg.done).toBe(false);
    await pacer.acquire(50, { priority: "foreground" }); // admitted at once
    await c.advance(60_000);
    expect(bg.done).toBe(true);
  });

  test("a pause holds every caller, and a shorter one never shortens it", async () => {
    const c = fakeClock();
    const pacer = createQuotaPacer({ unitsPerMinute: 100, clock: c.clock });
    pacer.pause(5_000);
    pacer.pause(1_000);
    const a = track(pacer.acquire(1, { priority: "foreground" }));
    await c.advance(4_999);
    expect(a.done).toBe(false);
    expect(pacer.stats().pausedForMs).toBe(1);
    await c.advance(1);
    expect(a.done).toBe(true);
    expect(pacer.stats().pausedForMs).toBeNull();
  });

  test("an aborted waiter leaves the queue and unblocks the next", async () => {
    const c = fakeClock();
    const pacer = createQuotaPacer({ unitsPerMinute: 100, clock: c.clock });
    await pacer.acquire(90, { priority: "foreground" });
    const ac = new AbortController();
    const big = pacer.acquire(50, {
      priority: "foreground",
      signal: ac.signal,
    });
    const small = track(pacer.acquire(10, { priority: "foreground" }));
    await Promise.resolve();
    expect(small.done).toBe(false); // FIFO: behind the big one
    ac.abort(new Error("gone"));
    expect(big).rejects.toThrow("gone");
    await Promise.resolve();
    expect(small.done).toBe(true);
    expect(pacer.stats().queued.foreground).toBe(0);
  });

  test("onQueued meters only a call that waits, ended as it is admitted or aborted", async () => {
    const c = fakeClock();
    const pacer = createQuotaPacer({ unitsPerMinute: 100, clock: c.clock });
    const log: string[] = [];
    const meter = (name: string) => () => {
      log.push(`begin ${name}`);
      return () => log.push(`end ${name}`);
    };
    await pacer.acquire(90, { priority: "foreground", onQueued: meter("now") });
    expect(log).toEqual([]); // admitted at once: no wait
    const late = track(
      pacer.acquire(20, { priority: "foreground", onQueued: meter("late") }),
    );
    const ac = new AbortController();
    const gone = pacer.acquire(20, {
      priority: "foreground",
      signal: ac.signal,
      onQueued: meter("gone"),
    });
    expect(log).toEqual(["begin late", "begin gone"]);
    ac.abort(new Error("gone"));
    expect(gone).rejects.toThrow("gone");
    expect(log).toEqual(["begin late", "begin gone", "end gone"]);
    await c.advance(60_000);
    expect(late.done).toBe(true);
    expect(log).toEqual(["begin late", "begin gone", "end gone", "end late"]);
  });

  test("onQueued says whether the budget or Google's rate pause held the call", async () => {
    const c = fakeClock();
    const pacer = createQuotaPacer({ unitsPerMinute: 100, clock: c.clock });
    const why: string[] = [];
    const meter = (r: string) => {
      why.push(r);
      return () => {};
    };
    await pacer.acquire(90, { priority: "foreground" });
    const budget = track(
      pacer.acquire(20, { priority: "foreground", onQueued: meter }),
    );
    await c.advance(60_000);
    expect(budget.done).toBe(true);
    pacer.pause(5_000);
    const paused = track(
      pacer.acquire(10, { priority: "foreground", onQueued: meter }),
    );
    expect(why).toEqual(["budget", "paused"]);
    await c.advance(5_000);
    expect(paused.done).toBe(true);
  });

  test("refuses a call that could never fit", () => {
    const pacer = createQuotaPacer({
      unitsPerMinute: 100,
      backgroundShare: 0.5,
    });
    expect(() => pacer.acquire(101, { priority: "foreground" })).toThrow(
      "can never fit",
    );
    expect(() => pacer.acquire(51, { priority: "background" })).toThrow(
      "can never fit",
    );
    expect(() => pacer.acquire(0, { priority: "foreground" })).toThrow(
      "positive integer",
    );
  });
});
