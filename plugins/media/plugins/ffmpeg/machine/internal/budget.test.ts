import { describe, expect, test } from "bun:test";
import { AUDIO_KBPS, MIN_VIDEO_KBPS, planBudget } from "./budget";

const MB = 1024 * 1024;

describe("planBudget", () => {
  test("budget·8·0.95/duration − audio", () => {
    // 10 MiB over 60 s: 10·1048576·8·0.95 / 60 / 1000 = 1328.6 kbps total.
    const plan = planBudget({
      budgetBytes: 10 * MB,
      durationMs: 60_000,
      hasAudio: true,
    });
    expect(plan).toEqual({
      kind: "encode",
      videoKbps: 1328 - AUDIO_KBPS,
      audioKbps: AUDIO_KBPS,
    });
  });

  test("a silent video keeps the whole budget for its picture", () => {
    const plan = planBudget({
      budgetBytes: 10 * MB,
      durationMs: 60_000,
      hasAudio: false,
    });
    expect(plan).toEqual({ kind: "encode", videoKbps: 1328, audioKbps: 0 });
  });

  test("too long for the budget: refused with what it would get", () => {
    // 10 MiB over 10 min: 132.9 kbps total, 4 kbps left for the picture.
    const plan = planBudget({
      budgetBytes: 10 * MB,
      durationMs: 600_000,
      hasAudio: true,
    });
    expect(plan).toEqual({
      kind: "too-long",
      videoKbps: 4,
      minVideoKbps: MIN_VIDEO_KBPS,
    });
  });

  test("a duration that is not positive throws", () => {
    expect(() =>
      planBudget({ budgetBytes: MB, durationMs: 0, hasAudio: false }),
    ).toThrow();
  });
});
