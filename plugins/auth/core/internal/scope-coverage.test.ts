import { test, expect } from "bun:test";
import { missingScopes } from "./scope-coverage";

test("missingScopes: granted undefined returns all (deduped)", () => {
  expect(missingScopes(["a", "b"], undefined)).toEqual(["a", "b"]);
});

test("missingScopes: granted empty returns all", () => {
  expect(missingScopes(["a", "b"], [])).toEqual(["a", "b"]);
});

test("missingScopes: full subset granted returns []", () => {
  expect(missingScopes(["a", "b"], ["a", "b"])).toEqual([]);
});

test("missingScopes: partial overlap returns the missing in original order", () => {
  expect(missingScopes(["a", "b", "c"], ["b"])).toEqual(["a", "c"]);
});

test("missingScopes: duplicates in required are deduped", () => {
  expect(missingScopes(["a", "a", "b", "b"], [])).toEqual(["a", "b"]);
});

test("missingScopes: granted superset returns []", () => {
  expect(missingScopes(["a"], ["a", "b", "c"])).toEqual([]);
});

const FULL = "https://mail.google.com/";
const MODIFY = "https://www.googleapis.com/auth/gmail.modify";

test("missingScopes: the full Gmail scope grants gmail.modify", () => {
  expect(missingScopes([MODIFY], [FULL])).toEqual([]);
});

test("missingScopes: gmail.modify does not grant the full Gmail scope", () => {
  expect(missingScopes([FULL], [MODIFY])).toEqual([FULL]);
});

test("missingScopes: a covering grant leaves other scopes missing", () => {
  expect(missingScopes([MODIFY, "drive"], [FULL])).toEqual(["drive"]);
});
