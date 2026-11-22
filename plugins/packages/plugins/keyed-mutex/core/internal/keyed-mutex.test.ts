import { describe, expect, test } from "bun:test";
import { createKeyedMutex, installKeyedMutexWaitMeter } from "./keyed-mutex";

function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((r) => {
    open = r;
  });
  return { promise, open };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("createKeyedMutex", () => {
  test("runs one key's calls one at a time, in arrival order", async () => {
    const mutex = createKeyedMutex("test");
    const log: string[] = [];
    const first = gate();
    const a = mutex.run("k", async () => {
      log.push("a:start");
      await first.promise;
      log.push("a:end");
      return "a";
    });
    const b = mutex.run("k", async () => {
      log.push("b:start");
      return "b";
    });
    const c = mutex.run("k", async () => {
      log.push("c:start");
      return "c";
    });
    await tick();
    expect(log).toEqual(["a:start"]);
    first.open();
    expect(await Promise.all([a, b, c])).toEqual(["a", "b", "c"]);
    expect(log).toEqual(["a:start", "a:end", "b:start", "c:start"]);
  });

  test("different keys run concurrently", async () => {
    const mutex = createKeyedMutex("test");
    const held = gate();
    let otherRan = false;
    const a = mutex.run("a", () => held.promise);
    await mutex.run("b", async () => {
      otherRan = true;
    });
    expect(otherRan).toBe(true);
    held.open();
    await a;
  });

  test("a rejection reaches its own caller only and does not stall the queue", async () => {
    const mutex = createKeyedMutex("test");
    const failed = mutex.run("k", async () => {
      throw new Error("boom");
    });
    const next = mutex.run("k", async () => "next");
    let caught: unknown;
    try {
      await failed;
    } catch (err) {
      caught = err;
    }
    expect((caught as Error).message).toBe("boom");
    expect(await next).toBe("next");
  });

  test("an idle key holds no entry", async () => {
    const mutex = createKeyedMutex("test");
    const held = gate();
    const a = mutex.run("k", () => held.promise);
    const b = mutex.run("k", async () => undefined);
    expect(mutex.size).toBe(1);
    held.open();
    await Promise.all([a, b]);
    await tick();
    expect(mutex.size).toBe(0);
  });

  test("a waiter aborted in the queue rejects at once, never runs, and keeps the order", async () => {
    const mutex = createKeyedMutex("test");
    const log: string[] = [];
    const first = gate();
    const a = mutex.run("k", async () => {
      log.push("a:start");
      await first.promise;
      log.push("a:end");
    });
    const abort = new AbortController();
    const b = mutex.run(
      "k",
      async () => {
        log.push("b:start");
      },
      { signal: abort.signal },
    );
    const c = mutex.run("k", async () => {
      log.push("c:start");
    });
    await tick();
    abort.abort(new Error("gave up"));
    let reason: unknown;
    try {
      await b;
    } catch (err) {
      reason = err;
    }
    expect((reason as Error).message).toBe("gave up");
    // c still waits for a, which is still running.
    await tick();
    expect(log).toEqual(["a:start"]);
    first.open();
    await Promise.all([a, c]);
    expect(log).toEqual(["a:start", "a:end", "c:start"]);
    await tick();
    expect(mutex.size).toBe(0);
  });

  test("a queued caller's wait is metered as mutex:<name>, an uncontended run's is not", async () => {
    const log: string[] = [];
    installKeyedMutexWaitMeter((layer) => {
      log.push(`begin ${layer}`);
      return () => log.push(`end ${layer}`);
    });
    try {
      const mutex = createKeyedMutex("agent-lifecycle");
      await mutex.run("k", async () => {});
      expect(log).toEqual([]);
      const first = gate();
      const a = mutex.run("k", () => first.promise);
      const b = mutex.run("k", async () => {
        log.push("b runs");
      });
      expect(log).toEqual(["begin mutex:agent-lifecycle"]);
      first.open();
      await Promise.all([a, b]);
      expect(log).toEqual([
        "begin mutex:agent-lifecycle",
        "end mutex:agent-lifecycle",
        "b runs",
      ]);
    } finally {
      installKeyedMutexWaitMeter(null);
    }
  });
});
