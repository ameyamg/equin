import { describe, expect, test } from "bun:test";
import { chunkDecision } from "./chunk-order";

describe("chunkDecision", () => {
  test("appends the next chunk", () => {
    expect(chunkDecision({ nextSeq: 0, lastSize: null }, 0, 10)).toEqual({
      kind: "append",
    });
    expect(chunkDecision({ nextSeq: 3, lastSize: 10 }, 3, 7)).toEqual({
      kind: "append",
    });
  });

  test("a replay of the last chunk is a no-op", () => {
    expect(chunkDecision({ nextSeq: 3, lastSize: 10 }, 2, 10)).toEqual({
      kind: "replay",
    });
  });

  test("a gap or a different replay is refused", () => {
    expect(chunkDecision({ nextSeq: 3, lastSize: 10 }, 5, 10).kind).toBe(
      "conflict",
    );
    expect(chunkDecision({ nextSeq: 3, lastSize: 10 }, 2, 11).kind).toBe(
      "conflict",
    );
    expect(chunkDecision({ nextSeq: 3, lastSize: 10 }, 0, 10).kind).toBe(
      "conflict",
    );
  });
});
