import { expect, test } from "bun:test";
import { tagRowsOfOptions } from "./option-rows";

test("tagRowsOfOptions: options become rows in their order, parents kept, swatches as colours", () => {
  const rows = tagRowsOfOptions([
    { value: "a", label: "A", swatch: "#ff0000" },
    { value: "b", label: "B", parent: "a" },
    { value: "c", label: "C", parent: "missing" },
  ]);
  expect(rows.map((r) => [r.id, r.name, r.parentId, r.color])).toEqual([
    ["a", "A", null, "#ff0000"],
    ["b", "B", "a", null],
    ["c", "C", null, null],
  ]);
  // Ranks follow the options' order.
  expect(rows[0]!.rank < rows[1]!.rank && rows[1]!.rank < rows[2]!.rank).toBe(
    true,
  );
});
