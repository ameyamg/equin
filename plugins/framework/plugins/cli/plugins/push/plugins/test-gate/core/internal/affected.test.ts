import { describe, expect, test } from "bun:test";
import { affectedTests } from "./affected";

describe("affectedTests", () => {
  test("a moved digest or a new file is affected; an unchanged or deleted one is not", () => {
    const head = new Map([
      ["a.test.ts", "1"],
      ["b.test.ts", "2"],
      ["new.test.ts", "3"],
    ]);
    const base = new Map([
      ["a.test.ts", "1"],
      ["b.test.ts", "old"],
      ["gone.test.ts", "4"],
    ]);
    expect(affectedTests(head, base)).toEqual(["b.test.ts", "new.test.ts"]);
  });
});
