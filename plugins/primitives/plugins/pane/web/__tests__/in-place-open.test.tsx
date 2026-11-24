import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import {
  PluginProvider,
  type LoadedPlugin,
} from "@plugins/framework/plugins/web-sdk/core";
import {
  Pane,
  setLiveStore,
  useSyncPaneRegistry,
  type PaneStore,
} from "@plugins/primitives/plugins/pane/web";
import { computeOpen } from "../pane";
import { defineApp, defineRoute } from "@plugins/primitives/plugins/pane/core";
import { createTestSurfaceStore, defaultStore } from "../testing";
import { symbol } from "@plugins/ui/plugins/icons/core";

// A MOVE WITHIN WHAT IS ON SCREEN KEEPS ITS INSTANCES.
//
// The Files shape: a folder column and the file previewed beside it. Going up
// a folder with the file still open is a new address for both columns, not
// new columns — an `inPlace` open keeps each instance standing where its pane
// stands, and Back to the previous address keeps them too.

const app = defineApp({
  id: "in-place-app",
  name: "In-place test app",
  basePath: "/",
  icon: symbol("science"),
});

const folderRoute = defineRoute({ id: "ip-folder", segment: "dir/:dir" });
const folderPane = Pane.define({
  route: folderRoute,
  app,
  useResolve: false,
  component: () => null,
});
const previewPane = Pane.define({
  route: defineRoute({
    id: "ip-preview",
    segment: "preview/:open",
    parent: folderRoute,
  }),
  app,
  useResolve: false,
  component: () => null,
});

const plugins = [
  {
    id: "in-place-test-plugin",
    description: "inPlace open fixture",
    contributions: [
      Pane.Register({ pane: folderPane }),
      Pane.Register({ pane: previewPane }),
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
  window.history.replaceState(null, "", "/");
  store = createTestSurfaceStore();
});

afterEach(() => {
  cleanup();
  setLiveStore(defaultStore);
  window.history.replaceState(null, "", "/");
});

function open(params: Record<string, string>, inPlace: boolean): void {
  const target =
    "open" in params ? previewPane._internal : folderPane._internal;
  const next = computeOpen(store.getRoute(), undefined, target, params, {
    mode: "root",
    inPlace,
  });
  if (next.changed) store.setRoute(next.route, next.replace);
}

const ids = () => store.getRoute().map((s) => [s.paneId, s.instanceId]);

describe("an inPlace open", () => {
  it("keeps every column standing where its pane stands, with its new params", () => {
    open({ dir: "a/b", open: "f.md" }, false);
    const before = ids();
    open({ dir: "a", open: "b/f.md" }, true);
    expect(ids()).toEqual(before);
    expect(store.getRoute().map((s) => s.params)).toEqual([
      { dir: "a" },
      { open: "b/f.md" },
    ]);
  });

  it("closes the columns the new route drops, and mints the ones it adds", () => {
    open({ dir: "a", open: "f.md" }, false);
    const [folder] = ids();
    open({ dir: "b" }, true);
    expect(ids()).toEqual([folder]);
    open({ dir: "b", open: "g.md" }, true);
    const [kept, added] = ids();
    expect(kept).toEqual(folder);
    expect(added![1]).not.toBe(undefined);
  });

  it("without it, a root open mints fresh instances", () => {
    open({ dir: "a", open: "f.md" }, false);
    const before = ids();
    open({ dir: "b", open: "f.md" }, false);
    expect(ids()[0]![1]).not.toBe(before[0]![1]);
  });
});

describe("back / forward", () => {
  it("keeps the instance of a slot whose uuid is on screen", () => {
    open({ dir: "a/b", open: "f.md" }, false);
    const first = window.history.state as unknown;
    const before = ids();
    open({ dir: "a", open: "b/f.md" }, true);
    window.history.replaceState(first, "", "/dir/a%2Fb/preview/f.md");
    store.handleLocationChange();
    expect(ids()).toEqual(before);
    expect(store.getRoute()[0]!.params).toEqual({ dir: "a/b" });
  });
});

// Two folder columns, each with its file: moving the SECOND one (its
// breadcrumb, a folder row) is a swap of its own column — the first pair
// stays. A root open rebuilt the whole route and lost the first pair.
describe("an inPlace swap of a second folder column", () => {
  function seedTwoPairs() {
    store.restoreRoute([
      { paneId: "ip-folder", params: { dir: "a" } },
      { paneId: "ip-preview", params: { open: "f.md" } },
      { paneId: "ip-folder", params: { dir: "b" } },
      { paneId: "ip-preview", params: { open: "g.md" } },
    ]);
  }

  function swapFrom(callerIndex: number, params: Record<string, string>) {
    const target =
      "open" in params ? previewPane._internal : folderPane._internal;
    const route = store.getRoute();
    const next = computeOpen(
      route,
      route[callerIndex]!.instanceId,
      target,
      params,
      { mode: "swap", inPlace: true },
    );
    if (next.changed) store.setRoute(next.route, next.replace);
  }

  it("with a file open keeps the columns left of it, and its own instances", () => {
    seedTwoPairs();
    const before = ids();
    swapFrom(2, { dir: "b/c", open: "h.md" });
    expect(ids()).toEqual(before);
    expect(store.getRoute().map((s) => s.params)).toEqual([
      { dir: "a" },
      { open: "f.md" },
      { dir: "b/c" },
      { open: "h.md" },
    ]);
  });

  it("opening a file from it keeps the first pair", () => {
    store.restoreRoute([
      { paneId: "ip-folder", params: { dir: "a" } },
      { paneId: "ip-preview", params: { open: "f.md" } },
      { paneId: "ip-folder", params: { dir: "b" } },
    ]);
    const route = store.getRoute();
    const next = computeOpen(
      route,
      route[2]!.instanceId,
      previewPane._internal,
      { dir: "b", open: "g.md" },
      { mode: "push" },
    );
    store.setRoute(next.route, next.replace);
    expect(store.getRoute().map((s) => s.params)).toEqual([
      { dir: "a" },
      { open: "f.md" },
      { dir: "b" },
      { open: "g.md" },
    ]);
    expect(store.getRoute()[0]!.instanceId).toBe(route[0]!.instanceId);
  });

  it("to a folder alone keeps the columns left of it", () => {
    seedTwoPairs();
    swapFrom(2, { dir: "c" });
    expect(store.getRoute().map((s) => s.params)).toEqual([
      { dir: "a" },
      { open: "f.md" },
      { dir: "c" },
    ]);
  });
});
