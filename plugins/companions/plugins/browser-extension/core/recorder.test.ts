import { describe, expect, test } from "bun:test";
import { OffscreenCommandSchema, RecorderStateSchema } from "./recorder";

const recording = {
  path: "/m/a.mp4",
  folder: "/m",
  name: "a.mp4",
  bytes: 1,
  durationMs: 1000,
  width: 1280,
  height: 720,
  thumbnail: null,
};

describe("state from an older shell", () => {
  // chrome.storage.session keeps the state across a shell update, and the
  // page can be newer than the shell: a saved recording from before
  // `stoppedBy` reads as "not said", never a parse failure.
  test("a saved recording without stoppedBy reads as null", () => {
    const state = RecorderStateSchema.parse({
      kind: "idle",
      last: { kind: "saved", recording },
    });
    expect(state).toEqual({
      kind: "idle",
      last: { kind: "saved", recording, stoppedBy: null, failure: null },
    });
  });

  // Commands are not lenient — a stop must say why — which is why the shell
  // refuses another build's messages before parsing them (chrome-api).
  test("a stop without its cause is refused", () => {
    expect(
      OffscreenCommandSchema.safeParse({
        type: "offscreen.stop",
        durationMs: 1,
        pointer: null,
      }).success,
    ).toBe(false);
  });
});
