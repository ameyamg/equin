import { describe, expect, test } from "bun:test";
import type { DataViewSection } from "@plugins/primitives/plugins/data-view/core";
import { stepOrder, stepTarget } from "./use-step-keys";

const section = (
  key: string | null,
  rows: string[],
  parentKey: string | null = null,
): DataViewSection<unknown> =>
  ({
    key,
    entries: rows.map((r) => ({ key: r, row: { id: r } })),
    nesting: parentKey === null ? undefined : { depth: 1, parentKey },
  }) as unknown as DataViewSection<unknown>;

describe("stepOrder", () => {
  test("the rows as drawn, section after section", () => {
    const order = stepOrder(
      [section("a", ["1", "2"]), section("b", ["3"])],
      undefined,
    );
    expect(order.map((r) => r.key)).toEqual(["1", "2", "3"]);
  });
  test("a collapsed section's rows are skipped", () => {
    const order = stepOrder(
      [section("a", ["1", "2"]), section("b", ["3"]), section("c", ["4"])],
      new Set(["b"]),
    );
    expect(order.map((r) => r.key)).toEqual(["1", "2", "4"]);
  });
  test("a section under a collapsed one is not drawn either", () => {
    const order = stepOrder(
      [section("a", ["1"]), section("a/b", ["2"], "a"), section("c", ["3"])],
      new Set(["a"]),
    );
    expect(order.map((r) => r.key)).toEqual(["3"]);
  });
});

describe("stepTarget", () => {
  const order = [{ key: "1" }, { key: "2" }, { key: "3" }];
  test("j and k move one row", () => {
    expect(stepTarget(order, "2", 1)?.key).toBe("3");
    expect(stepTarget(order, "2", -1)?.key).toBe("1");
  });
  test("no wrap at either end", () => {
    expect(stepTarget(order, "3", 1)).toBeNull();
    expect(stepTarget(order, "1", -1)).toBeNull();
  });
  test("nothing selected: j takes the first row, k nothing", () => {
    expect(stepTarget(order, undefined, 1)?.key).toBe("1");
    expect(stepTarget(order, undefined, -1)).toBeNull();
    expect(stepTarget(order, "gone", 1)?.key).toBe("1");
  });
});
