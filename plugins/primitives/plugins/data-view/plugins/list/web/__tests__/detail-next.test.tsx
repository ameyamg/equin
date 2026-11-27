import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import {
  PluginProvider,
  type LoadedPlugin,
} from "@plugins/framework/plugins/web-sdk/core";
import { WithShortcuts } from "@plugins/primitives/plugins/shortcuts/web/testing";
import type {
  DataViewRenderProps,
  FieldDef,
} from "@plugins/primitives/plugins/data-view/web";
import type { ListDetailControls } from "../../core";
import { ListView } from "../components/list-view";

/**
 * A row's detail moves on (`ListDetailControls.openNext`): this detail
 * closes, the next drawn row's opens — and on the last row nothing changes.
 */

const plugin = {
  id: "data-view-list-detail-next-test",
  description: "list detail-next fixture",
  contributions: [],
} as unknown as LoadedPlugin;

type Row = { id: string; name: string };

const FIELDS: FieldDef<Row>[] = [
  {
    id: "name",
    label: "Name",
    type: "text",
    value: (r) => r.name,
    primary: true,
  },
];

const ROWS: Row[] = [1, 2, 3].map((i) => ({ id: `r${i}`, name: `row ${i}` }));

/** A list whose expand map is held here, each detail a Next button. */
function DetailList({ exclusive }: { exclusive: boolean }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    r1: true,
  });
  const [last, setLast] = useState<string>("");
  const props: DataViewRenderProps<Row> = {
    revealSelection: true,
    placement: {},
    rows: ROWS,
    fields: FIELDS,
    rowKey: (r) => r.id,
    state: { sort: [], query: "", filter: null },
    setSort: () => {},
    setSortDirection: () => {},
    updateViewOptions: () => {},
    hideField: () => {},
    sortHeader: { active: [], sortable: new Set<string>() },
    setFilter: () => {},
    expanded,
    setExpanded: (changes) =>
      setExpanded((prev) => {
        const next = { ...prev };
        for (const c of changes) next[c.id] = c.expanded;
        return next;
      }),
    now: 0,
    groupOrder: "asc",
    rowsComplete: true,
    sectioning: { kind: "bucket" },
    options: {
      detailOnActivate: true,
      detailExclusive: exclusive,
      detail: (r: Row, controls: ListDetailControls) => (
        <button
          type="button"
          onClick={() => setLast(controls.openNext() ?? "none")}
        >
          {`next from ${r.id}`}
        </button>
      ),
    },
  };
  return (
    <section data-testid="list" data-last={last}>
      <ListView {...(props as unknown as DataViewRenderProps<unknown>)} />
    </section>
  );
}

/** The details shown open (one folding away is still painted, closed). */
function openDetails(): string[] {
  return screen
    .queryAllByRole("button", { name: /^next from / })
    .filter((b) => b.closest('[data-state="closed"]') === null)
    .map((b) => b.textContent ?? "");
}

afterEach(cleanup);

describe("list detail openNext", () => {
  it("closes this detail and opens the next row's, then stops at the end", () => {
    render(
      <PluginProvider plugins={[plugin]}>
        <WithShortcuts>
          <DetailList exclusive />
        </WithShortcuts>
      </PluginProvider>,
    );
    expect(openDetails()).toEqual(["next from r1"]);
    fireEvent.click(screen.getByRole("button", { name: "next from r1" }));
    expect(openDetails()).toEqual(["next from r2"]);
    expect(screen.getByTestId("list").getAttribute("data-last")).toBe("r2");
    fireEvent.click(screen.getByRole("button", { name: "next from r2" }));
    fireEvent.click(screen.getByRole("button", { name: "next from r3" }));
    // The last row: nothing to open, its detail stays.
    expect(openDetails()).toEqual(["next from r3"]);
    expect(screen.getByTestId("list").getAttribute("data-last")).toBe("none");
  });
});
