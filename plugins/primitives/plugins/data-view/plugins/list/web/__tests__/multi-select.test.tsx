import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  PluginProvider,
  type LoadedPlugin,
} from "@plugins/framework/plugins/web-sdk/core";
import {
  installStorage,
  QuotaStorage,
} from "@plugins/primitives/plugins/dom/plugins/web-storage/web/testing";
import { KeepScope } from "@plugins/primitives/plugins/kept-state/web";
import { WithShortcuts } from "@plugins/primitives/plugins/shortcuts/web/testing";
import { useMultiSelect } from "@plugins/primitives/plugins/multi-select/web";
import type {
  DataViewRenderProps,
  FieldDef,
} from "@plugins/primitives/plugins/data-view/web";
import { ListView } from "../components/list-view";

/**
 * Checkbox multi-select in the list (`DataViewRenderProps.selection`): each
 * row leads with its box, a box toggles without activating the row, the bar
 * shows the count and the bulk actions (which read the selection), Escape
 * clears, and a checked row that leaves the rows leaves the selection.
 */

const plugin = {
  id: "data-view-list-multi-select-test",
  description: "list multi-select fixture",
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

/** A bulk action: reads the selection the way a consumer does. */
function ArchiveAction({ onRun }: { onRun: (ids: string[]) => void }) {
  const { selectedIds, clearAll } = useMultiSelect();
  return (
    <button
      type="button"
      onClick={() => {
        onRun([...selectedIds].sort());
        clearAll();
      }}
    >
      Archive
    </button>
  );
}

let place = 0;
function view(rows: Row[], over: Partial<DataViewRenderProps<Row>>): ReactNode {
  const props: DataViewRenderProps<Row> = {
    revealSelection: true,
    placement: {},
    rows,
    fields: FIELDS,
    rowKey: (r) => r.id,
    state: { sort: [], query: "", filter: null },
    setSort: () => {},
    setSortDirection: () => {},
    updateViewOptions: () => {},
    hideField: () => {},
    sortHeader: { active: [], sortable: new Set<string>() },
    setFilter: () => {},
    setExpanded: () => {},
    now: 0,
    groupOrder: "asc",
    rowsComplete: true,
    sectioning: { kind: "bucket" },
    options: undefined,
    ...over,
  };
  return (
    <PluginProvider plugins={[plugin]}>
      <WithShortcuts>
        <KeepScope segment="t:tab">
          <KeepScope segment={`p:${place}`}>
            <ListView {...(props as unknown as DataViewRenderProps<unknown>)} />
          </KeepScope>
        </KeepScope>
      </WithShortcuts>
    </PluginProvider>
  );
}

beforeAll(() => {
  installStorage("local", new QuotaStorage());
  installStorage("session", new QuotaStorage());
});
afterEach(() => {
  cleanup();
  place += 1;
});

const boxOf = (container: HTMLElement, key: string): HTMLElement =>
  container.querySelector<HTMLElement>(
    `[data-row-key="${key}"] [data-selection-box]`,
  )!;
const checkedKeys = (container: HTMLElement): string[] =>
  [...container.querySelectorAll<HTMLElement>("[data-checked]")].map(
    (el) => el.querySelector<HTMLElement>("[data-row-key]")!.dataset.rowKey!,
  );

describe("list multi-select", () => {
  it("draws no box and no bar without `selection`", () => {
    const { container } = render(view(ROWS, {}));
    expect(container.querySelector("[data-selection-box]")).toBeNull();
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
  });

  it("a box toggles its row without activating it", () => {
    const activate = vi.fn();
    const { container, getByText } = render(
      view(ROWS, {
        rowActivation: () => activate,
        selection: { keep: "list", bar: "bottom" },
      }),
    );
    const box = boxOf(container, "r2");
    expect(box.getAttribute("role")).toBe("checkbox");
    // Outside the row's own control: never a button inside a button.
    expect(box.parentElement!.closest("button")).toBeNull();
    fireEvent.click(box);
    expect(activate).not.toHaveBeenCalled();
    expect(box.getAttribute("aria-checked")).toBe("true");
    expect(checkedKeys(container)).toEqual(["r2"]);
    fireEvent.click(box);
    expect(box.getAttribute("aria-checked")).toBe("false");
    expect(checkedKeys(container)).toEqual([]);
    // The row itself still activates.
    fireEvent.click(getByText("row 1").closest("button")!);
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it("shift-click adds the range from the anchor", () => {
    const { container } = render(view(ROWS, { selection: { keep: "list" } }));
    fireEvent.click(boxOf(container, "r1"));
    fireEvent.click(boxOf(container, "r3"), { shiftKey: true });
    expect(checkedKeys(container)).toEqual(["r1", "r2", "r3"]);
  });

  it("the bottom bar shows the count and the bulk actions, which read the selection", () => {
    const run = vi.fn();
    const { container, getByText, getByRole } = render(
      view(ROWS, {
        selection: {
          keep: "list",
          bar: "bottom",
          bulkActions: <ArchiveAction onRun={run} />,
        },
      }),
    );
    const bar = container.querySelector<HTMLElement>(
      '[data-selection-bar="bottom"]',
    )!;
    // Drawn after the rows (a bottom sticky sticks within the box it ends),
    // inert while nothing is selected.
    expect(
      container
        .querySelector('[data-row-key="r3"]')!
        .compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(bar.hasAttribute("inert")).toBe(true);
    fireEvent.click(boxOf(container, "r1"));
    fireEvent.click(boxOf(container, "r3"));
    expect(bar.hasAttribute("inert")).toBe(false);
    expect(getByText("2 selected")).toBeTruthy();
    fireEvent.click(getByText("Archive"));
    expect(run).toHaveBeenCalledWith(["r1", "r3"]);
    expect(checkedKeys(container)).toEqual([]);
    // The clear ✕.
    fireEvent.click(boxOf(container, "r2"));
    fireEvent.click(getByRole("button", { name: "Clear selection" }));
    expect(checkedKeys(container)).toEqual([]);
  });

  it("Escape clears the selection", () => {
    const { container } = render(view(ROWS, { selection: { keep: "list" } }));
    fireEvent.click(boxOf(container, "r1"));
    expect(checkedKeys(container)).toEqual(["r1"]);
    act(() => {
      fireEvent.keyDown(boxOf(container, "r1"), { key: "Escape" });
    });
    expect(checkedKeys(container)).toEqual([]);
  });

  it("a checked row that leaves the rows leaves the selection", () => {
    const selection = { keep: "list" };
    const { container, rerender, getByText } = render(
      view(ROWS, { selection }),
    );
    fireEvent.click(boxOf(container, "r1"));
    fireEvent.click(boxOf(container, "r2"));
    expect(getByText("2 selected")).toBeTruthy();
    rerender(view(ROWS.slice(1), { selection }));
    expect(checkedKeys(container)).toEqual(["r2"]);
    expect(getByText("1 selected")).toBeTruthy();
    // It does not come back with its row.
    rerender(view(ROWS, { selection }));
    expect(checkedKeys(container)).toEqual(["r2"]);
  });
});
