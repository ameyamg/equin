import { test, expect } from "bun:test";
import { missingScopes } from "@plugins/auth/core";
import { mergeScopes } from "./scopes";

test("mergeScopes: dedupes and preserves order", () => {
  expect(mergeScopes(["a", "b"], ["b", "c"], ["a", "d"])).toEqual([
    "a",
    "b",
    "c",
    "d",
  ]);
});

test("mergeScopes: skips undefined inputs", () => {
  expect(mergeScopes(undefined, ["a"], undefined, ["b", "a"])).toEqual([
    "a",
    "b",
  ]);
});

test("mergeScopes: no inputs returns []", () => {
  expect(mergeScopes()).toEqual([]);
  expect(mergeScopes(undefined)).toEqual([]);
  expect(mergeScopes([])).toEqual([]);
});

test("invariant: after merging the missing into granted, nothing is missing", () => {
  const cases: [string[], string[] | undefined][] = [
    [["a", "b", "c"], ["b"]],
    [["a", "b"], undefined],
    [["x"], []],
    [["a", "a", "b"], ["a"]],
  ];
  for (const [req, granted] of cases) {
    const merged = mergeScopes(granted, missingScopes(req, granted));
    expect(missingScopes(req, merged)).toEqual([]);
  }
});
