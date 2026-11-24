import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import {
  PluginProvider,
  markDeferredLoadComplete,
  type LoadedPlugin,
} from "@plugins/framework/plugins/web-sdk/core";
import { resetDeferredLoadStateForTests } from "@plugins/framework/plugins/web-sdk/core/testing";
import {
  Pane,
  setLiveStore,
  useSyncPaneRegistry,
  type PaneStore,
} from "@plugins/primitives/plugins/pane/web";
import { impliedBy, sameAs } from "../implied";
import { validRestoredRoute } from "../pane";
import { defineApp, defineRoute } from "@plugins/primitives/plugins/pane/core";
import { createTestSurfaceStore, defaultStore } from "../testing";
import { symbol } from "@plugins/ui/plugins/icons/core";

// A SAVED ROUTE IS NOT TRUSTED.
//
// `history.state` and a persisted tab hold the route verbatim, as the build
// that wrote it knew it. A later build can have removed the pane, or made a
// param required (a satellite now carrying its conversation). Restoring such
// a slot as it is put a pane on screen without its address — so restore
// validates, and an invalid route is re-read from its URL.

const app = defineApp({
  id: "restore-app",
  name: "Restore validation test app",
  basePath: "/",
  icon: symbol("science"),
});

const convRoute = defineRoute({ id: "rv-conv", segment: "c/:convId" });
const convPane = Pane.define({
  route: convRoute,
  app,
  useResolve: false,
  component: () => null,
});
const summaryPane = Pane.define({
  route: defineRoute({ id: "rv-summary", segment: "sum;conv" }),
  app,
  component: () => null,
  implied: { conv: impliedBy(convRoute, sameAs("convId")) },
});

const plugins = [
  {
    id: "restore-validation-test-plugin",
    description: "restore validation fixture",
    contributions: [
      Pane.Register({ pane: convPane }),
      Pane.Register({ pane: summaryPane }),
    ],
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
  resetDeferredLoadStateForTests();
  window.history.replaceState(null, "", "/");
  store = createTestSurfaceStore();
});

afterEach(() => {
  resetDeferredLoadStateForTests();
  setLiveStore(defaultStore);
  window.history.replaceState(null, "", "/");
});

const shape = () =>
  store.getRoute().map((s) => ({ paneId: s.paneId, params: s.params }));

describe("validRestoredRoute", () => {
  it("accepts slots whose panes are registered and carry their required params", () => {
    expect(
      validRestoredRoute([
        { paneId: "rv-conv", params: { convId: "A" } },
        { paneId: "rv-summary", params: { conv: "A" } },
      ]),
    ).toEqual({ ok: true });
  });

  it("names a pane that is not registered", () => {
    expect(validRestoredRoute([{ paneId: "rv-gone", params: {} }])).toEqual({
      ok: false,
      reason: "unregistered",
      paneId: "rv-gone",
    });
  });

  it("names a missing required positional param", () => {
    expect(validRestoredRoute([{ paneId: "rv-conv", params: {} }])).toEqual({
      ok: false,
      reason: "missing-param",
      paneId: "rv-conv",
      param: "convId",
    });
  });

  it("names a missing required implied param", () => {
    expect(
      validRestoredRoute([
        { paneId: "rv-conv", params: { convId: "A" } },
        { paneId: "rv-summary", params: {} },
      ]),
    ).toEqual({
      ok: false,
      reason: "missing-param",
      paneId: "rv-summary",
      param: "conv",
    });
  });
});

describe("back / forward onto a saved route", () => {
  it("restores a valid route as saved", () => {
    window.history.replaceState(
      {
        route: [
          { paneId: "rv-conv", params: { convId: "A" } },
          { paneId: "rv-summary", params: { conv: "A" } },
        ],
      },
      "",
      "/c/A/sum",
    );
    store.handleLocationChange();
    expect(shape()).toEqual([
      { paneId: "rv-conv", params: { convId: "A" } },
      { paneId: "rv-summary", params: { conv: "A" } },
    ]);
  });

  it("re-reads its URL when a slot lacks a param its pane now requires", () => {
    // An older build's satellite: no `conv` in its state.
    window.history.replaceState(
      {
        route: [
          { paneId: "rv-conv", params: { convId: "A" } },
          { paneId: "rv-summary", params: {} },
        ],
      },
      "",
      "/c/A/sum",
    );
    store.handleLocationChange();
    expect(shape()).toEqual([
      { paneId: "rv-conv", params: { convId: "A" } },
      { paneId: "rv-summary", params: { conv: "A" } },
    ]);
  });

  it("re-reads its URL for a pane gone once loading has settled", () => {
    markDeferredLoadComplete();
    window.history.replaceState(
      { route: [{ paneId: "rv-gone", params: {} }] },
      "",
      "/c/B",
    );
    store.handleLocationChange();
    expect(shape()).toEqual([{ paneId: "rv-conv", params: { convId: "B" } }]);
  });

  it("keeps a pane not registered yet while deferred plugins still load", () => {
    window.history.replaceState(
      { route: [{ paneId: "rv-later", params: { x: "1" } }] },
      "",
      "/later/1",
    );
    store.handleLocationChange();
    expect(shape()).toEqual([{ paneId: "rv-later", params: { x: "1" } }]);
  });
});
