import { describe, expect, test } from "bun:test";
import type { ComponentType } from "react";
import type { JsonValue } from "@plugins/config_v2/core";
import type { SealContributions } from "@plugins/framework/plugins/web-sdk/core";
import type {
  ViewConfigRow,
  ViewSourceEntry,
  ViewTypeMeta,
} from "@plugins/primitives/plugins/data-view/plugins/view-core/core";
import { buildInstanceFromRow } from "@plugins/primitives/plugins/data-view/plugins/view-core/web/testing";
import { dataViewDescriptors } from "./descriptors";

/**
 * A user's saved `type: "tree"` row still loads now that no `tree` view-type is
 * registered: a backend deriving its config generation replays the
 * descriptor's `tree-view-to-table` migration over the saved files BEFORE
 * anything reads them, so the resolver only ever sees a `table` row. Driven through the real per-id descriptor, so dropping the
 * migration from `viewMigrations` (or the descriptor wiring) fails here.
 */

const ID = "agents-list";

const Icon: ComponentType<{ className?: string }> = () => null;
/** Only the table is registered — the tree view-type is gone. */
const entry: ViewSourceEntry = {
  contributions: [
    { type: "table", title: "Table", icon: Icon },
  ] as unknown as SealContributions<ViewTypeMeta>[],
};

const savedRow = {
  id: "mine",
  name: "My tree",
  view: { type: "tree", filterScope: "roots", expandOnActivate: true },
};

describe("a saved tree row after the tree view-type is gone", () => {
  test("unmigrated, it would not resolve (why the migration must run first)", () => {
    expect(buildInstanceFromRow(savedRow as ViewConfigRow, [entry])).toBeNull();
  });

  test("the descriptor's migrations rewrite it into a table that resolves", () => {
    const descriptor = dataViewDescriptors.get(ID)!;
    // Every migration the descriptor declares, in order — what the derive's
    // migration ledger runs over a saved document.
    const doc = (descriptor.migrations ?? []).reduce<JsonValue>(
      (d, m) => m.apply(d),
      { views: [savedRow] },
    ) as unknown as { views: ViewConfigRow[] };
    const resolved = buildInstanceFromRow(doc.views[0]!, [entry]);
    expect(resolved).not.toBeNull();
    expect(resolved!.instance.type).toBe("table");
    expect(resolved!.instance.options).toEqual({
      type: "table",
      presentation: "outline",
      filterScope: "roots",
      expandOnActivate: true,
    });
  });
});
