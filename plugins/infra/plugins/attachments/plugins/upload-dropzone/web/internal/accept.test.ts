import { describe, expect, test } from "bun:test";
import { inputAccept, matchesAccept } from "./accept";

describe("matchesAccept", () => {
  test("a family, an exact mime, anything, several", () => {
    expect(matchesAccept("image/*", "image/png")).toBe(true);
    expect(matchesAccept("image/*", "video/mp4")).toBe(false);
    expect(matchesAccept("video/mp4", "video/mp4")).toBe(true);
    expect(matchesAccept("*", "")).toBe(true);
    expect(matchesAccept(["image/*", "video/*"], "video/webm")).toBe(true);
    expect(matchesAccept(["image/*", "video/*"], "audio/mpeg")).toBe(false);
  });
});

describe("inputAccept", () => {
  test("joins a list; none for anything", () => {
    expect(inputAccept(["image/*", "video/*"])).toBe("image/*,video/*");
    expect(inputAccept("*")).toBeUndefined();
  });
});
