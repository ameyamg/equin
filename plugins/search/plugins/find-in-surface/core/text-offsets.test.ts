import { describe, expect, test } from "bun:test";
import { endPoint, startPoint } from "./text-offsets";

// "abc" "\n" "de" — the line break belongs to no part.
const parts = [
  { at: 0, length: 3 },
  { at: 4, length: 2 },
];

describe("text offsets", () => {
  test("a point inside a part", () => {
    expect(startPoint(parts, 1)).toEqual({ part: 0, offset: 1 });
    expect(endPoint(parts, 2)).toEqual({ part: 0, offset: 2 });
    expect(startPoint(parts, 5)).toEqual({ part: 1, offset: 1 });
  });

  test("a match starting on the line break begins at the next part", () => {
    expect(startPoint(parts, 3)).toEqual({ part: 1, offset: 0 });
  });

  test("a match ending on the line break stops at the end of the part before", () => {
    expect(endPoint(parts, 4)).toEqual({ part: 0, offset: 3 });
  });

  test("a match ending at the end of the text", () => {
    expect(endPoint(parts, 6)).toEqual({ part: 1, offset: 2 });
  });
});
