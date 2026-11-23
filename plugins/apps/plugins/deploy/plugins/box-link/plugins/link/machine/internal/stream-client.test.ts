import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { BoxHelloFrame } from "@plugins/apps/plugins/deploy/plugins/box-link/core";
import { createStreamClient, type StreamTransport } from "./stream-client";

// The link manager disables a stream client when its tunnel drops; that abort
// is the stream's expected end — never an unhandled rejection
// (report-1795431120-azhd86: one false crash per tunnel drop).

let unhandled: unknown[];
const onUnhandled = (err: unknown) => {
  unhandled.push(err);
};

beforeEach(() => {
  unhandled = [];
  process.on("unhandledRejection", onUnhandled);
});

afterEach(() => {
  process.off("unhandledRejection", onUnhandled);
});

const HELLO: BoxHelloFrame = {
  kind: "hello",
  v: 1,
  startedAt: 0,
  buildId: null,
  signals: [],
};

/** Like `fetch`: the body says hello, then stays open; the signal errors it with its reason. */
const fetchLike: StreamTransport = (_path, signal) =>
  Promise.resolve(
    new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode(`${JSON.stringify(HELLO)}\n`));
          signal.addEventListener("abort", () => c.error(signal.reason), {
            once: true,
          });
        },
      }),
    ),
  );

describe("stream client", () => {
  test("disabling a client mid-stream ends the stream quietly", async () => {
    const failures: unknown[] = [];
    let helloSeen!: () => void;
    const hello = new Promise<void>((resolve) => {
      helloSeen = resolve;
    });
    const client = createStreamClient(fetchLike, {
      hello: () => {
        helloSeen();
      },
      beat: () => {},
      signal: () => {},
      routeMissing: (error) => failures.push(error),
      failed: (failure) => failures.push(failure),
    });
    client.enable();
    await hello;
    client.disable();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(failures).toEqual([]);
    expect(unhandled).toEqual([]);
  });
});
