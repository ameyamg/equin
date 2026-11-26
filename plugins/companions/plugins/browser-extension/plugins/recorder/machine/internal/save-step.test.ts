import { describe, expect, test } from "bun:test";
import { ABANDONED_AFTER_MS, saveStep } from "./save-step";
import type { Upload } from "./upload-store";

const NOW = 1_800_000_000_000;
const pointer = {
  version: 1 as const,
  viewport: { width: 1280, height: 720 },
  samples: [],
};

function upload(over: Partial<Upload> = {}): Upload {
  return {
    id: "df861715-4089-4065-bf01-8fa6784224a8",
    folder: "/r",
    partial: "/r/.x.partial.mp4",
    base: "2026-11-26 10.00 Plan",
    cursor: {
      base: "2026-11-26 10.00 Plan",
      nextSeq: 3,
      lastSize: 10,
      bytes: 30,
      finishRequested: null,
    },
    cursorProblem: null,
    bytes: 30,
    writtenAt: NOW - 1000,
    finishingBy: null,
    ...over,
  };
}

describe("saveStep", () => {
  test("a recording saved or discarded is gone", () => {
    expect(saveStep(null, NOW)).toEqual({ kind: "gone" });
  });

  test("a recording still taking chunks waits until it would count as left", () => {
    expect(saveStep(upload(), NOW)).toEqual({
      kind: "wait",
      atMs: NOW - 1000 + ABANDONED_AFTER_MS,
    });
  });

  test("a save asked for runs now, with its pointer track", () => {
    const u = upload();
    u.cursor!.finishRequested = { pointer };
    expect(saveStep(u, NOW)).toEqual({ kind: "save", pointer });
  });

  test("a recording its browser left is saved without a pointer track", () => {
    const u = upload({ writtenAt: NOW - ABANDONED_AFTER_MS });
    expect(saveStep(u, NOW)).toEqual({ kind: "save", pointer: null });
  });

  test("a partial that takes no more chunks (no cursor) is saved now", () => {
    expect(saveStep(upload({ cursor: null, bytes: 12 }), NOW)).toEqual({
      kind: "save",
      pointer: null,
    });
  });

  test("one holding no byte has nothing to save", () => {
    expect(saveStep(upload({ cursor: null, bytes: 0 }), NOW)).toEqual({
      kind: "empty",
    });
  });
});
