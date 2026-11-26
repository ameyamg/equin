import { describe, expect, test } from "bun:test";
import {
  MIN_HELD_EMPTY_MS,
  reconnectDelayMs,
  startPushConsumer,
  type PushConsumerDeps,
  type PushConsumerState,
} from "./consumer";

type PullAnswer =
  | { kind: "hang" }
  | { kind: "messages"; ackIds: string[]; heldMs?: number }
  | { kind: "gone" }
  | { kind: "throw"; error: Error };

/** A consumer over scripted pulls on a fake clock; a pull past the script waits until stopped. */
function harness(script: PullAnswer[], prepareFails: Error[] = []) {
  let clock = 0;
  const states: PushConsumerState[] = [];
  const acked: string[][] = [];
  const sleeps: number[] = [];
  const events: string[] = [];
  let changed = 0;
  let prepares = 0;
  const bounds: { ms: number; fn: () => void }[] = [];
  let settle: () => void = () => {};
  const idle = new Promise<void>((r) => (settle = r));
  let hung: () => void = () => {};
  const hanging = new Promise<void>((r) => (hung = r));
  const deps: PushConsumerDeps = {
    prepare: async () => {
      prepares++;
      events.push("prepare");
      const e = prepareFails.shift();
      if (e) throw e;
    },
    pull: async (signal) => {
      const next = script.shift();
      if (!next) {
        settle();
        await new Promise<void>((_, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        );
        throw new Error("unreachable");
      }
      if (next.kind === "throw") throw next.error;
      if (next.kind === "hang") {
        hung();
        await new Promise<void>((_, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        );
        throw new Error("unreachable");
      }
      if (next.kind === "messages") clock += next.heldMs ?? 5_000;
      return next.kind === "gone"
        ? next
        : { kind: "messages", ackIds: next.ackIds };
    },
    ack: async (ids) => {
      events.push("ack");
      acked.push([...ids]);
    },
    changed: () => {
      events.push("changed");
      changed++;
    },
    onState: (s) => states.push(s),
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
    after: (ms, fn) => {
      bounds.push({ ms, fn });
      return () => {
        const i = bounds.findIndex((b) => b.fn === fn);
        if (i >= 0) bounds.splice(i, 1);
      };
    },
  };
  const c = startPushConsumer(deps);
  return {
    c,
    idle,
    hanging,
    states,
    acked,
    sleeps,
    events,
    changed: () => changed,
    prepares: () => prepares,
    /** Fire the held pull's bound (as if it stayed open PULL_BOUND_MS). */
    cutPull: () => bounds.at(-1)!.fn(),
  };
}

describe("the push consumer", () => {
  test("starts, prepares, goes live, signals each batch before acking it", async () => {
    const h = harness([
      { kind: "messages", ackIds: ["a", "b"] },
      { kind: "messages", ackIds: [] },
      { kind: "messages", ackIds: ["c"] },
    ]);
    await h.idle;
    await h.c.stop();
    expect(h.states.map((s) => s.kind)).toEqual(["starting", "live"]);
    expect(h.changed()).toBe(2);
    expect(h.acked).toEqual([["a", "b"], ["c"]]);
    expect(h.events).toEqual(["prepare", "changed", "ack", "changed", "ack"]);
    expect(h.prepares()).toBe(1);
  });

  test("a failure is down, then a backoff, then prepare again and live", async () => {
    const h = harness([
      { kind: "throw", error: new Error("offline") },
      { kind: "throw", error: new Error("still offline") },
      { kind: "messages", ackIds: ["x"] },
    ]);
    await h.idle;
    await h.c.stop();
    expect(h.states.map((s) => s.kind)).toEqual([
      "starting",
      "live",
      "down",
      "down",
      "live",
    ]);
    const downs = h.states.filter((s) => s.kind === "down");
    // One outage keeps its first instant.
    expect(downs[0]!.since).toBe(downs[1]!.since);
    expect((downs[1] as { message: string }).message).toBe("still offline");
    expect(h.sleeps).toEqual([reconnectDelayMs(1), reconnectDelayMs(2)]);
    expect(h.prepares()).toBe(3);
    expect(h.changed()).toBe(1);
  });

  test("a failing prepare stays down and retries with a growing wait", async () => {
    const h = harness(
      [{ kind: "messages", ackIds: ["x"] }],
      [new Error("403 PERMISSION_DENIED"), new Error("403 PERMISSION_DENIED")],
    );
    await h.idle;
    await h.c.stop();
    expect(h.states.map((s) => s.kind)).toEqual([
      "starting",
      "down",
      "down",
      "live",
    ]);
    expect(h.sleeps).toEqual([1_000, 2_000]);
  });

  test("a subscription gone is down (re-prepared after the wait)", async () => {
    const h = harness([{ kind: "gone" }, { kind: "messages", ackIds: ["x"] }]);
    await h.idle;
    await h.c.stop();
    expect(h.states.map((s) => s.kind)).toEqual([
      "starting",
      "live",
      "down",
      "live",
    ]);
    expect((h.states[2] as { message: string }).message).toContain(
      "no longer exists",
    );
    expect(h.prepares()).toBe(2);
  });

  test("an empty pull answered at once is refused: the loop never polls", async () => {
    const h = harness([
      { kind: "messages", ackIds: [], heldMs: MIN_HELD_EMPTY_MS - 1 },
      { kind: "messages", ackIds: ["x"] },
    ]);
    await h.idle;
    await h.c.stop();
    expect(h.states.map((s) => s.kind)).toEqual([
      "starting",
      "live",
      "down",
      "live",
    ]);
    expect(h.sleeps).toEqual([1_000]);
  });

  test("a pull held to its bound is cut and sent again, not a failure", async () => {
    const h = harness([{ kind: "hang" }, { kind: "messages", ackIds: ["x"] }]);
    await h.hanging;
    h.cutPull();
    await h.idle;
    await h.c.stop();
    expect(h.states.map((s) => s.kind)).toEqual(["starting", "live"]);
    expect(h.sleeps).toEqual([]);
    expect(h.changed()).toBe(1);
  });

  test("after a failure, a pull held to its bound brings push back live", async () => {
    const h = harness([
      { kind: "throw", error: new Error("offline") },
      { kind: "hang" },
    ]);
    await h.hanging;
    h.cutPull();
    await h.idle;
    await h.c.stop();
    expect(h.states.map((s) => s.kind)).toEqual([
      "starting",
      "live",
      "down",
      "live",
    ]);
  });

  test("stop aborts the held pull and ends the loop without a down", async () => {
    const h = harness([]);
    await h.idle;
    await h.c.stop();
    expect(h.states.map((s) => s.kind)).toEqual(["starting", "live"]);
  });

  test("the reconnect wait doubles from 1 s to 60 s", () => {
    expect([1, 2, 3, 6, 7, 20].map(reconnectDelayMs)).toEqual([
      1_000, 2_000, 4_000, 32_000, 60_000, 60_000,
    ]);
  });
});
