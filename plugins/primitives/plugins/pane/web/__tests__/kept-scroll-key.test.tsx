import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import {
  PluginProvider,
  type LoadedPlugin,
} from "@plugins/framework/plugins/web-sdk/core";
import {
  Pane,
  PaneInstance,
  setLiveStore,
  usePaneMatch,
  useSyncPaneRegistry,
  type PaneStore,
} from "@plugins/primitives/plugins/pane/web";
import { SurfaceIdContext } from "@plugins/primitives/plugins/scope/plugins/surface-id/web";
import { defineApp, defineRoute } from "@plugins/primitives/plugins/pane/core";
import { createTestSurfaceStore, TestSurface, defaultStore } from "../testing";
import { PaneScroll } from "../components/pane-scroll";
import { symbol } from "@plugins/ui/plugins/icons/core";

// ONE PANE OPENED TWICE IN A CHAIN KEEPS TWO SCROLL OFFSETS.
//
// `A | B | A` — the same pane at the same address twice (a prototype linking to
// one that links back, report-1795658217-pvolrz). Each instance's body scroller
// keeps its offset under the pane instance's key; when that key was only
// (tab, pane, address, views), both A's claimed one key and the second threw
// "Two live scrollers keep their offset under …" into its column.

const app = defineApp({
  id: "kept-key-app",
  name: "Kept key test app",
  basePath: "/kk",
  icon: symbol("science"),
});

const aPane = Pane.define({
  route: defineRoute({ id: "kk-a", segment: "a/:id" }),
  app,
  useResolve: false,
  component: () => null,
});
const bPane = Pane.define({
  route: defineRoute({ id: "kk-b", segment: "b" }),
  app,
  component: () => null,
});

const testPlugin = {
  id: "kept-scroll-key-test-plugin",
  description: "kept-scroll-key fixture",
  contributions: [aPane, bPane].map((pane) => Pane.Register({ pane })),
} as unknown as LoadedPlugin;
const plugins = [testPlugin];

function RegistrySync() {
  useSyncPaneRegistry();
  return null;
}

/** Every route entry drawn as a layout draws it: an instance and its body scroller. */
function Columns() {
  const match = usePaneMatch();
  return (
    <>
      {match?.panes.map((entry) => (
        <PaneInstance key={entry.instanceId} entry={entry}>
          <PaneScroll data-testid={`col-${entry.instanceId}`}>
            {entry.pane.id}
          </PaneScroll>
        </PaneInstance>
      ))}
    </>
  );
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
  store.setBasePath("/kk");
});

afterEach(() => {
  cleanup();
  setLiveStore(defaultStore);
  window.history.replaceState(null, "", "/");
});

describe("kept-scroll key of a pane instance", () => {
  it("one pane at one address twice in a chain mounts both scrollers", () => {
    store.restoreRoute([
      { paneId: "kk-a", params: { id: "x" } },
      { paneId: "kk-b", params: {} },
      { paneId: "kk-a", params: { id: "x" } },
    ]);
    const view = render(
      <TestSurface store={store} plugins={plugins} basePath="/kk">
        <SurfaceIdContext.Provider value="tab-1">
          <Columns />
        </SurfaceIdContext.Provider>
      </TestSurface>,
    );
    const kept = [...view.container.querySelectorAll("[data-scroll-kept]")].map(
      (el) => el.getAttribute("data-scroll-kept"),
    );
    // Three scrollers kept, under three distinct keys.
    expect(kept).toHaveLength(3);
    expect(new Set(kept).size).toBe(3);
  });
});
