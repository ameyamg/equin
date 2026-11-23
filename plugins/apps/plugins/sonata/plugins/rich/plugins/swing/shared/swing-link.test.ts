import { describe, expect, it } from "bun:test";
import { decodeSwingLink, encodeSwingLink } from "./swing-link";

describe("swing link", () => {
  it("spells the song's own feel as nothing", () => {
    expect(encodeSwingLink({ kind: "score" })).toBeNull();
  });

  it("round-trips a swing and a straight override", () => {
    for (const override of [
      { kind: "swing", swing: { unit: 8, ratio: 2 } },
      { kind: "swing", swing: { unit: 16, ratio: 1.5 } },
      { kind: "straight", feel: { unit: 8, ratio: 3 } },
    ] as const) {
      const value = encodeSwingLink(override);
      expect(value).not.toBeNull();
      expect(decodeSwingLink(value ?? "")).toEqual(override);
    }
  });

  it("reads the words as written", () => {
    expect(
      encodeSwingLink({ kind: "swing", swing: { unit: 8, ratio: 2 } }),
    ).toBe("8x2");
    expect(decodeSwingLink("straight")).toEqual({
      kind: "straight",
      feel: { unit: 8, ratio: 2 },
    });
  });

  it("refuses what is not a swing", () => {
    expect(decodeSwingLink("12x2")).toBeNull();
    expect(decodeSwingLink("8x9")).toBeNull();
    expect(decodeSwingLink("swing")).toBeNull();
    expect(decodeSwingLink("straight.nope")).toBeNull();
  });
});
