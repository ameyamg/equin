import { describe, expect, test } from "bun:test";
import {
  contextNudgeText,
  mainThreadContextTokens,
  nextNudge,
  nudgeBucket,
} from "./context-nudge";

const t = { firstAt: 500_000, every: 100_000 };

function run(readings: number[]): boolean[] {
  let last = -1;
  return readings.map((tokens) => {
    const next = nextNudge(last, tokens, t);
    last = next.lastBucket;
    return next.nudge;
  });
}

describe("context nudge", () => {
  test("buckets", () => {
    expect(nudgeBucket(499_999, t)).toBe(-1);
    expect(nudgeBucket(500_000, t)).toBe(0);
    expect(nudgeBucket(599_999, t)).toBe(0);
    expect(nudgeBucket(600_000, t)).toBe(1);
  });

  test("first at 500k, then every 100k, once each", () => {
    expect(
      run([100_000, 499_000, 510_000, 550_000, 610_000, 650_000, 720_000]),
    ).toEqual([false, false, true, false, true, false, true]);
  });

  test("a jump over several thresholds nudges once", () => {
    expect(run([400_000, 830_000, 840_000])).toEqual([false, true, false]);
  });

  test("a compaction starts the sequence over", () => {
    expect(run([620_000, 80_000, 300_000, 505_000])).toEqual([
      true,
      false,
      false,
      true,
    ]);
  });

  test("text names the size and the window", () => {
    expect(contextNudgeText(612_400, 1_000_000)).toStartWith(
      "Your context is 612k / 1M tokens.",
    );
    expect(contextNudgeText(612_400, null)).toStartWith(
      "Your context is 612k tokens.",
    );
    expect(contextNudgeText(612_400, null)).toContain("compact_context");
  });

  test("main-thread usage only", () => {
    const usage = {
      input_tokens: 10,
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 3000,
      output_tokens: 5,
    };
    expect(
      mainThreadContextTokens({
        type: "assistant",
        parent_tool_use_id: null,
        message: { usage },
      } as never),
    ).toBe(3210);
    expect(
      mainThreadContextTokens({
        type: "assistant",
        parent_tool_use_id: "toolu_1",
        message: { usage },
      } as never),
    ).toBeNull();
    expect(mainThreadContextTokens({ type: "result" })).toBeNull();
    expect(() =>
      mainThreadContextTokens({
        type: "assistant",
        parent_tool_use_id: null,
        message: {},
      } as never),
    ).toThrow();
  });
});
