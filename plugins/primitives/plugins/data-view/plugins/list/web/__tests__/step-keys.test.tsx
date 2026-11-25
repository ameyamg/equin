import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
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
import { ListView } from "../components/list-view";

/**
 * j / k with two stepping lists on one surface: each list answers only the
 * keys that land in it (focus, else the pointer) — never the list that
 * registered first.
 */

const plugin = {
  id: "data-view-list-step-keys-test",
  description: "list step-keys fixture",
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

/** One stepping list whose selection follows its row activation. */
function SteppingList({ prefix }: { prefix: string }) {
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const rows: Row[] = [1, 2, 3].map((i) => ({
    id: `${prefix}${i}`,
    name: `${prefix} row ${i}`,
  }));
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
    selectedRowId: selected,
    rowActivation: (r) => () => setSelected(r.id),
    options: { stepKeys: true },
  };
  return (
    <section data-testid={prefix} data-selected={selected ?? ""}>
      <ListView {...(props as unknown as DataViewRenderProps<unknown>)} />
    </section>
  );
}

function renderTwo() {
  return render(
    <PluginProvider plugins={[plugin]}>
      <WithShortcuts>
        <SteppingList prefix="a" />
        <SteppingList prefix="b" />
      </WithShortcuts>
    </PluginProvider>,
  );
}

const selectedOf = (el: HTMLElement) => el.getAttribute("data-selected");

afterEach(cleanup);

describe("list step keys, two lists on one surface", () => {
  it("j / k step the list holding focus, never the other", () => {
    const { getByTestId, getByText } = renderTwo();
    const inB = getByText("b row 1").closest("button")!;
    fireEvent.keyDown(inB, { key: "j" });
    fireEvent.keyDown(inB, { key: "j" });
    expect(selectedOf(getByTestId("b"))).toBe("b2");
    expect(selectedOf(getByTestId("a"))).toBe("");
    const inA = getByText("a row 3").closest("button")!;
    fireEvent.keyDown(inA, { key: "j" });
    expect(selectedOf(getByTestId("a"))).toBe("a1");
    fireEvent.keyDown(inB, { key: "k" });
    expect(selectedOf(getByTestId("b"))).toBe("b1");
    expect(selectedOf(getByTestId("a"))).toBe("a1");
  });

  it("with focus in neither, the list under the pointer steps", () => {
    const { getByTestId, getByText } = renderTwo();
    fireEvent.pointerOver(getByText("a row 2"));
    fireEvent.keyDown(document.body, { key: "j" });
    expect(selectedOf(getByTestId("a"))).toBe("a1");
    expect(selectedOf(getByTestId("b"))).toBe("");
  });

  it("with focus and pointer in neither, nothing steps", () => {
    const { getByTestId } = renderTwo();
    fireEvent.keyDown(document.body, { key: "j" });
    expect(selectedOf(getByTestId("a"))).toBe("");
    expect(selectedOf(getByTestId("b"))).toBe("");
  });
});
