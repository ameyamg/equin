import { describe, expect, test } from "bun:test";
import { acceptedSet, changedKeys, jsonEqual } from "./diff";

describe("jsonEqual", () => {
  test("objects by keys whatever their order, arrays in order", () => {
    expect(
      jsonEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }),
    ).toBe(true);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(jsonEqual({ a: null }, { a: 0 })).toBe(false);
    expect(jsonEqual([], {})).toBe(false);
  });
});

describe("changedKeys", () => {
  test("the keys that differ, in field order", () => {
    expect(
      changedKeys(
        ["title", "body", "media"],
        { title: "a", body: "b", media: [] },
        { media: [], body: "c", title: "a" },
      ),
    ).toEqual(["body"]);
  });
});

describe("acceptedSet", () => {
  const fieldKeys = ["title", "body", "media"];
  test("a plain accept writes only what the proposal changed", () => {
    // The user changed the title on main since; the proposal changed the body.
    expect(
      acceptedSet({
        fieldKeys,
        proposed: { title: "agent's stale", body: "new", media: [] },
        changed: ["body"],
        edited: null,
      }),
    ).toEqual({ body: "new" });
  });
  test("an accept with edits writes exactly the keys the user's copy sets", () => {
    expect(
      acceptedSet({
        fieldKeys,
        proposed: { title: "t", body: "new", media: [] },
        changed: ["body"],
        edited: { body: "new, reworded", title: "t2", stray: 1 },
      }),
    ).toEqual({ title: "t2", body: "new, reworded" });
  });
});
