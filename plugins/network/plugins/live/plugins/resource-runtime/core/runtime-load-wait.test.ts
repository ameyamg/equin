/**
 * A subscription's read may say what it waits on (`LoadRun.wait`): every
 * holder of the tuple is sent a `waiting` frame, a sub arriving while the
 * wait stands is told at once, the wait's end while the read goes on is
 * `on: null`, and a wait still open when the answer lands ends silently with
 * it (the answer tells the tab). From report-1795721286-0gc0z2: a Mail view
 * waiting ~56 s on Gmail's per-minute quota looked wedged.
 */

import { test, expect, describe } from "bun:test";
import { z } from "zod";
import { createHarness, tick, type Harness } from "./test-support";
import type { LoadRun } from "./runtime";

/** A `row` whose loader parks until released, handing out its `LoadRun`. */
function defineWaiting(h: Harness) {
  const runs: (LoadRun | undefined)[] = [];
  const releases: (() => void)[] = [];
  h.runtime.defineExternalResource<string, { id: string }>({
    key: "row",
    mode: "push",
    schema: z.string(),
    loader: ({ id }, _ctx, run) => {
      runs.push(run);
      return new Promise<string>((resolve) => {
        releases.push(() => resolve(`row ${id}`));
      });
    },
  });
  return {
    runs,
    release: () => {
      for (const r of releases.splice(0)) r();
    },
  };
}

const waitingFrames = (h: Harness) =>
  h.frames.filter((f) => f.kind === "waiting");

describe("a known wait on a subscription's read", () => {
  test("is sent to the holder, then its end; the answer follows", async () => {
    const h = createHarness();
    const row = defineWaiting(h);
    await h.subscribe("row", { id: "a" });
    await tick();
    const run = row.runs[0];
    expect(run?.wait).toBeDefined();

    const end = run!.wait!("Waiting on the quota");
    // The same wait again is not re-sent.
    const again = run!.wait!("Waiting on the quota");
    expect(waitingFrames(h)).toMatchObject([
      { key: "row", params: { id: "a" }, on: "Waiting on the quota" },
    ]);
    again();
    expect(waitingFrames(h)).toHaveLength(1);
    end();
    expect(waitingFrames(h).at(-1)).toMatchObject({ on: null });
    end(); // idempotent
    expect(waitingFrames(h)).toHaveLength(2);

    row.release();
    await tick();
    await tick();
    expect(h.frames.filter((f) => f.key === "row").map((f) => f.kind)).toEqual([
      "waiting",
      "waiting",
      "sub-ack",
    ]);
  });

  test("a sub arriving while it stands is told at once", async () => {
    const h = createHarness({ sockets: 2 });
    const row = defineWaiting(h);
    await h.subscribe("row", { id: "a" }, { socket: 0 });
    await tick();
    row.runs[0]!.wait!("Waiting on the quota");
    await h.subscribe("row", { id: "a" }, { socket: 1 });
    await tick();
    expect(
      waitingFrames(h).map((f) => ({
        socket: f.socket,
        on: (f as { on?: unknown }).on,
      })),
    ).toEqual([
      { socket: 0, on: "Waiting on the quota" },
      { socket: 1, on: "Waiting on the quota" },
    ]);
    // Both joined the one read.
    expect(row.runs).toHaveLength(1);
  });

  test("a socket of an older vocabulary (another PROTOCOL) is never sent one", async () => {
    const h = createHarness({ sockets: 2 });
    const row = defineWaiting(h);
    await h.subscribe("row", { id: "a" }, { socket: 0 });
    await h.subscribe("row", { id: "a" }, { socket: 1, protocol: "rp-older" });
    await tick();
    row.runs[0]!.wait!("Waiting on the quota");
    await h.subscribe("row", { id: "a" }, { socket: 1, protocol: "rp-older" });
    await tick();
    expect(waitingFrames(h).map((f) => f.socket)).toEqual([0]);
  });

  test("still open when the answer lands, it ends silently", async () => {
    const h = createHarness();
    const row = defineWaiting(h);
    await h.subscribe("row", { id: "a" });
    await tick();
    const end = row.runs[0]!.wait!("Waiting on the quota");
    row.release();
    await tick();
    await tick();
    end(); // after the answer: nothing to tell
    expect(h.frames.filter((f) => f.key === "row").map((f) => f.kind)).toEqual([
      "waiting",
      "sub-ack",
    ]);
    // A later sub is told of no wait.
    await h.subscribe("row", { id: "b" });
    await tick();
    expect(waitingFrames(h)).toHaveLength(1);
  });

  test("an HTTP read's wait tells only the tuple's holders — here none", async () => {
    const h = createHarness();
    const row = defineWaiting(h);
    const res = h.runtime.handleResourceHttp(
      new Request("http://localhost/api/resources/row?id=a"),
      { key: "row" },
    );
    await tick();
    row.runs[0]!.wait!("Waiting on the quota")();
    expect(waitingFrames(h)).toEqual([]);
    row.release();
    expect((await res).status).toBe(200);
  });
});
