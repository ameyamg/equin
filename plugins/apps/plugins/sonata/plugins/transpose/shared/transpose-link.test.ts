import { describe, expect, it } from "bun:test";
import { decodeTransposeLink, encodeTransposeLink } from "./transpose-link";

describe("transpose link", () => {
  it("spells the original key as nothing", () => {
    expect(encodeTransposeLink(0)).toBeNull();
  });

  it("round-trips an offset", () => {
    for (const n of [-12, -2, 3, 12]) {
      expect(decodeTransposeLink(encodeTransposeLink(n) ?? "")).toBe(n);
    }
    expect(decodeTransposeLink("+5")).toBe(5);
  });

  it("refuses what is not an offset in range", () => {
    expect(decodeTransposeLink("13")).toBeNull();
    expect(decodeTransposeLink("1.5")).toBeNull();
    expect(decodeTransposeLink("up")).toBeNull();
  });
});
