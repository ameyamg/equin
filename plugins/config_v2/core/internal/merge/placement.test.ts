import { describe, expect, test } from "bun:test";
import type { JsonValue } from "../types";
import { deepMerge } from "./deep-merge";
import {
  checkPlacement,
  parsePlacementAnswer,
  valueAtMergePath,
  withListOrder,
} from "./placement";

describe("the merge reports where it placed the update's new rows", () => {
  test("a row the update added to a list the user reordered", () => {
    const out = deepMerge(
      { items: ["a", "b", "c"] },
      { items: ["c", "a", "b"] },
      { items: ["a", "b", "n", "c"] },
    );
    expect(out.merged).toEqual({ items: ["c", "a", "b", "n"] });
    expect(out.placements).toEqual([
      {
        path: ["items"],
        order: ["s:c", "s:a", "s:b", "s:n"],
        movable: ["s:n"],
      },
    ]);
  });

  test("nothing to place when the user did not touch the list", () => {
    const out = deepMerge(
      { items: ["a"], x: 1 },
      { items: ["a"], x: 2 },
      { items: ["a", "n"], x: 1 },
    );
    expect(out.placements).toEqual([]);
  });

  test("the user's own additions are not movable", () => {
    const out = deepMerge(
      { cols: [{ id: "a" }, { id: "b" }] },
      { cols: [{ id: "a" }, { id: "mine" }, { id: "b" }] },
      { cols: [{ id: "a" }, { id: "b" }, { id: "n" }] },
    );
    expect(out.placements).toEqual([
      {
        path: ["cols"],
        order: ["id:a", "id:mine", "id:b", "id:n"],
        movable: ["id:n"],
      },
    ]);
  });
});

describe("checkPlacement", () => {
  const list = {
    path: ["items"],
    order: ["s:c", "s:a", "s:b", "s:n"],
    movable: ["s:n"],
  };

  test("a permutation moving only new rows is accepted", () => {
    expect(checkPlacement(list, ["s:c", "s:n", "s:a", "s:b"])).toEqual({
      ok: true,
      order: ["s:c", "s:n", "s:a", "s:b"],
    });
  });

  test("an answer reordering the user's rows is refused", () => {
    expect(checkPlacement(list, ["s:a", "s:c", "s:b", "s:n"])).toEqual({
      ok: false,
      reason: "reordered your rows",
    });
  });

  test("dropped, added, repeated or malformed keys are refused", () => {
    expect(checkPlacement(list, ["s:c", "s:a", "s:b"])).toMatchObject({
      ok: false,
      reason: "dropped s:n",
    });
    expect(
      checkPlacement(list, ["s:c", "s:a", "s:b", "s:n", "s:x"]),
    ).toMatchObject({ ok: false, reason: "unknown row s:x" });
    expect(
      checkPlacement(list, ["s:c", "s:n", "s:a", "s:b", "s:n"]),
    ).toMatchObject({ ok: false, reason: "row s:n twice" });
    expect(checkPlacement(list, "s:c")).toMatchObject({ ok: false });
    expect(checkPlacement(list, [1, 2])).toMatchObject({ ok: false });
  });
});

describe("merge paths into a written document", () => {
  // A written document carries seeded ids the merge compared rows without.
  const COLUMNS: JsonValue[] = [
    { item: "x" },
    { id: "auto-000000000002", item: "y" },
  ];
  const doc: { [key: string]: JsonValue } = {
    views: [
      {
        id: "auto-000000000001",
        label: "Main",
        columns: COLUMNS,
      },
    ],
  };
  const path = ["views", "[label:Main]", "columns"];

  test("rows are found by the key the merge paired them by", () => {
    expect(valueAtMergePath(doc, path)).toEqual(COLUMNS);
  });

  test("a list is reordered copy-on-write", () => {
    const next = withListOrder(doc, path, ["item:y", "item:x"]);
    expect(next.views).toEqual([
      {
        id: "auto-000000000001",
        label: "Main",
        columns: [{ id: "auto-000000000002", item: "y" }, { item: "x" }],
      },
    ]);
    expect(COLUMNS[0]).toEqual({ item: "x" });
    expect(valueAtMergePath(doc, path)).toEqual(COLUMNS);
  });

  test("an order that is not the list's rows throws", () => {
    expect(() => withListOrder(doc, path, ["item:y"])).toThrow(
      "does not hold the rows",
    );
  });
});

describe("parsePlacementAnswer", () => {
  test("one entry per list, a code fence tolerated", () => {
    expect(parsePlacementAnswer('```json\n[["s:a"]]\n```', 2)).toEqual([
      ["s:a"],
      undefined,
    ]);
  });
  test("one list's keys without the outer array", () => {
    expect(parsePlacementAnswer('["s:b","s:a"]', 1)).toEqual([["s:b", "s:a"]]);
    expect(parsePlacementAnswer('["s:b","s:a"]', 2)).toEqual(["s:b", "s:a"]);
  });
  test("prose is no answer", () => {
    expect(parsePlacementAnswer("I would put it first.", 1)).toBeNull();
    expect(parsePlacementAnswer('{"a":1}', 1)).toBeNull();
  });
});
