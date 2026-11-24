import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

import {
  PluginProvider,
  type LoadedPlugin,
} from "@plugins/framework/plugins/web-sdk/core";
import {
  Pane,
  PaneInstanceContext,
  setLiveStore,
  useOpenPane,
  useSyncPaneRegistry,
  type PaneStore,
} from "@plugins/primitives/plugins/pane/web";
import { computeOpen } from "../pane";
import { PLAIN_GESTURE } from "@plugins/primitives/plugins/link-gesture/core";
import { defineApp, defineRoute } from "@plugins/primitives/plugins/pane/core";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { createTestSurfaceStore, TestSurface, defaultStore } from "../testing";

// A REORDERED ROUTE KEEPS ITS ADDRESSES.
//
// Dragging a Miller column left of the one it was opened from (a file preview
// left of its folder) used to cut it off: every read of "the pane I hang off"
// looked only to its left, so the preview found no folder and said the link
// named none. The pane a column declares as its ancestor is the one it hangs
// off wherever it stands.

const app = defineApp({
  id: "reorder-app",
  name: "Reorder",
  basePath: "/ro",
  icon: symbol("science"),
});

const folderRoute = defineRoute({ id: "ro-folder", segment: "browse/:dir" });
const folderPane = Pane.define({
  route: folderRoute,
  app,
  useResolve: false,
  component: () => null,
});
const previewPane = Pane.define({
  route: defineRoute({
    id: "ro-preview",
    segment: "preview/:open",
    parent: folderRoute,
  }),
  app,
  useResolve: false,
  component: () => null,
});
// Declares no ancestor: standing beside a folder does not make it the folder's.
const otherPane = Pane.define({
  route: defineRoute({ id: "ro-other", segment: "other" }),
  app,
  component: () => null,
});

const all = [folderPane, previewPane, otherPane];
const plugins = [
  {
    id: "reordered-route-test-plugin",
    description: "reordered-route fixture",
    contributions: all.map((pane) => Pane.Register({ pane })),
  } as unknown as LoadedPlugin,
];

function RegistrySync() {
  useSyncPaneRegistry();
  return null;
}

let store: PaneStore;

beforeAll(() => {
  render(
    <PluginProvider plugins={plugins}>
      <RegistrySync />
    </PluginProvider>,
  );
  cleanup();
});

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  store = createTestSurfaceStore();
  store.setBasePath("/ro");
});

afterEach(() => {
  cleanup();
  setLiveStore(defaultStore);
  window.history.replaceState(null, "", "/");
});

const short = (id: string) => id.replace("ro-", "");
const ids = () => store.getRoute().map((s) => short(s.paneId));

/** `[folder /a, preview x]`, then the preview dragged left of its folder. */
function seedReordered() {
  store.restoreRoute([
    { paneId: "ro-folder", params: { dir: "a" } },
    { paneId: "ro-preview", params: { open: "x" } },
  ]);
  store.reorderRoute(1, 0);
  expect(ids()).toEqual(["preview", "folder"]);
}

function within(index: number, node: React.ReactNode): HTMLElement {
  const view = render(
    <TestSurface store={store} plugins={plugins} basePath="/ro">
      <PaneInstanceContext.Provider value={store.getRoute()[index]!.instanceId}>
        {node}
      </PaneInstanceContext.Provider>
    </TestSurface>,
  );
  return view.container;
}

function EnclosingFolder() {
  const entry = folderPane.useEnclosing();
  return <output>{entry === null ? "none" : entry.params.dir}</output>;
}

function OpenedPreview() {
  const entry = previewPane.useOpenedHere();
  return <output>{entry === null ? "none" : entry.params.open}</output>;
}

function OpenPreview({ open }: { open: string }) {
  const openPane = useOpenPane();
  return (
    <button
      type="button"
      {...openPane.link(previewPane, { dir: "a", open }, { mode: "push" })}
    >
      open
    </button>
  );
}

const read = (index: number, node: React.ReactNode) =>
  within(index, node).querySelector("output")!.textContent;

describe("a pane reordered left of the pane it hangs off", () => {
  it("still reads that pane as the one enclosing it", () => {
    seedReordered();
    expect(read(0, <EnclosingFolder />)).toBe("a");
  });

  it("is still the one its ancestor opened", () => {
    seedReordered();
    expect(read(1, <OpenedPreview />)).toBe("x");
  });

  it("opening another one from the ancestor replaces it where it stands", () => {
    seedReordered();
    const container = within(1, <OpenPreview open="y" />);
    fireEvent.click(container.querySelector("button")!);
    expect(ids()).toEqual(["preview", "folder"]);
    expect(store.getRoute()[0]!.params).toEqual({ open: "y" });
  });

  it("closes alone, from the head", () => {
    seedReordered();
    store.close(
      previewPane._internal,
      store.getRoute()[0]!.instanceId,
      PLAIN_GESTURE,
    );
    expect(ids()).toEqual(["folder"]);
  });

  it("goes with its ancestor when the ancestor closes", () => {
    store.restoreRoute([
      { paneId: "ro-other", params: {} },
      { paneId: "ro-folder", params: { dir: "a" } },
      { paneId: "ro-preview", params: { open: "x" } },
    ]);
    store.reorderRoute(2, 0);
    expect(ids()).toEqual(["preview", "other", "folder"]);
    store.close(
      folderPane._internal,
      store.getRoute()[2]!.instanceId,
      PLAIN_GESTURE,
    );
    expect(ids()).toEqual(["other"]);
  });
});

describe("swapping the ancestor a pane was reordered off", () => {
  function swap(params: Record<string, string>) {
    const target =
      "open" in params ? previewPane._internal : folderPane._internal;
    const route = store.getRoute();
    const next = computeOpen(route, route[1]!.instanceId, target, params, {
      mode: "swap",
    });
    if (next.changed) store.setRoute(next.route, next.replace);
  }

  it("to another folder drops the preview left of it", () => {
    seedReordered();
    swap({ dir: "b" });
    expect(ids()).toEqual(["folder"]);
  });

  it("to another folder and file leaves one preview", () => {
    seedReordered();
    swap({ dir: "b", open: "y" });
    expect(ids()).toEqual(["folder", "preview"]);
  });
});

describe("a pane that declares no ancestor", () => {
  it("hangs off nothing right of it", () => {
    store.restoreRoute([
      { paneId: "ro-other", params: {} },
      { paneId: "ro-folder", params: { dir: "a" } },
    ]);
    expect(read(0, <EnclosingFolder />)).toBe("none");
  });
});

describe("an unreordered route", () => {
  it("reads the nearest ancestor left of it, as before", () => {
    store.restoreRoute([
      { paneId: "ro-folder", params: { dir: "a" } },
      { paneId: "ro-folder", params: { dir: "b" } },
      { paneId: "ro-preview", params: { open: "x" } },
    ]);
    expect(read(2, <EnclosingFolder />)).toBe("b");
    expect(read(0, <OpenedPreview />)).toBe("none");
    expect(read(1, <OpenedPreview />)).toBe("x");
  });
});
