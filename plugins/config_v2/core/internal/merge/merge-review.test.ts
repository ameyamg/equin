import { describe, expect, test } from "bun:test";
import { isSeededRowId, seededRowId } from "../collections";
import { withoutSeededIds } from "./merge-review";

describe("withoutSeededIds", () => {
  test("drops the ids normalizeCollectionItems seeds", () => {
    const seeded = seededRowId(0, { label: "a" });
    expect(isSeededRowId(seeded)).toBe(true);
    expect(withoutSeededIds([{ id: seeded, label: "a" }])).toEqual([
      { label: "a" },
    ]);
  });

  test("keeps an authored id that only starts with auto-", () => {
    // The Config nav's own `auto-merged` view (config_v2.settings.nav.jsonc).
    const views = [{ id: "auto-merged", label: "Auto-merged" }];
    expect(isSeededRowId("auto-merged")).toBe(false);
    expect(withoutSeededIds(views)).toEqual(views);
  });
});
