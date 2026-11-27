import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineEndpoint } from "../../core/define-endpoint";
import type { Transport } from "@plugins/primitives/plugins/networking/web";
import { beaconEndpointOver } from "./beacon-endpoint";

const ping = defineEndpoint({
  route: "POST /api/ping/:id",
  body: z.object({ n: z.number() }),
  response: z.object({ ok: z.boolean() }),
});

/** A transport whose beacon records what it was handed and answers `queued`. */
function transportWith(beacon: Transport["beacon"]): Transport {
  return {
    socketUrl: (path) => path,
    server: "page",
    openSocket: () => {
      throw new Error("these tests open no socket");
    },
    fetch: () => Promise.reject(new Error("a beacon never fetches")),
    servesUrls: true,
    requestTiming: false,
    content: null,
    machine: true,
    telemetry: true,
    beacon,
  };
}

describe("beaconEndpointOver", () => {
  test("posts the encoded body to the interpolated path", () => {
    const handed: { path: string; body: string }[] = [];
    const send = beaconEndpointOver(
      transportWith((path, body) => {
        handed.push({ path, body });
        return true;
      }),
    );
    expect(send(ping, { id: "a" }, { body: { n: 1 } })).toEqual({
      kind: "queued",
    });
    expect(handed).toHaveLength(1);
    expect(handed[0]!.path).toBe("/api/ping/a");
    expect(JSON.parse(handed[0]!.body)).toEqual({ n: 1 });
  });

  test("a beacon the browser would not queue is refused", () => {
    const send = beaconEndpointOver(transportWith(() => false));
    expect(send(ping, { id: "a" }, { body: { n: 1 } })).toEqual({
      kind: "refused",
    });
  });

  test("a transport no browser delivers for has no beacon sender", () => {
    expect(() => beaconEndpointOver(transportWith(null))).toThrow(
      "delivers no beacons",
    );
  });
});
