import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { useEffect } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";

import {
  PluginProvider,
  type LoadedPlugin,
} from "@plugins/framework/plugins/web-sdk/core";
import {
  appNavSink,
  Pane,
  PaneInstanceContext,
  setLiveStore,
  useOpenPane,
  useSyncPaneRegistry,
  type OpenPaneFn,
  type PaneStore,
} from "@plugins/primitives/plugins/pane/web";
import { impliedBy, relativeTo } from "../implied";
import type { LinkTarget } from "@plugins/primitives/plugins/link-gesture/core";
import { PLAIN_GESTURE } from "@plugins/primitives/plugins/link-gesture/core";
import { defineApp, defineRoute } from "@plugins/primitives/plugins/pane/core";
import { computeColumnsOpen, paneColumn } from "../pane";
import { createTestSurfaceStore, TestSurface, defaultStore } from "../testing";
import { symbol } from "@plugins/ui/plugins/icons/core";

// A DESTINATION CAN BE SEVERAL COLUMNS.
//
// A folder with a file previewed beside it is one place, two columns.
// `openPane.columns` opens such a list: `root` makes the route the list,
// `swap` replaces the caller's column and everything right of it. Its href is
// the URL its plain click lands on, and a list headed by another app's pane
// goes to that app.

const app = defineApp({
  id: "columns-app",
  name: "Columns test app",
  basePath: "/cols",
  icon: symbol("science"),
});
const otherApp = defineApp({
  id: "columns-other-app",
  name: "Other columns app",
  basePath: "/other",
  icon: symbol("science"),
});

const listPane = Pane.define({
  route: defineRoute({ id: "co-list", segment: "list" }),
  app,
  component: () => null,
});
const folderRoute = defineRoute({ id: "co-folder", segment: "dir/:dir" });
const folderPane = Pane.define({
  route: folderRoute,
  app,
  useResolve: false,
  component: () => null,
});
const previewPane = Pane.define({
  route: defineRoute({ id: "co-preview", segment: "pv/:path" }),
  app,
  useResolve: false,
  component: () => null,
  implied: {
    path: impliedBy(
      folderRoute,
      relativeTo("dir", {
        within: (v, b) =>
          v.startsWith(b + "/") ? v.slice(b.length + 1) : undefined,
        join: (b, r) => `${b}/${r}`,
        isWhole: (w) => w.startsWith("/"),
      }),
    ),
  },
});
const guestPane = Pane.define({
  route: defineRoute({ id: "co-guest", segment: "guest/:g" }),
  app: otherApp,
  useResolve: false,
  component: () => null,
});
const historylessPane = Pane.define({
  route: defineRoute({ id: "co-nohist", segment: "nohist" }),
  app,
  component: () => null,
  chrome: { history: false },
});

const plugins = [
  {
    id: "columns-open-test-plugin",
    description: "openPane.columns fixture",
    contributions: [
      Pane.Register({ pane: listPane }),
      Pane.Register({ pane: folderPane }),
      Pane.Register({ pane: previewPane }),
      Pane.Register({ pane: guestPane }),
      Pane.Register({ pane: historylessPane }),
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
  store.setBasePath("/cols");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setLiveStore(defaultStore);
  window.history.replaceState(null, "", "/");
});

const pair = (dir: string, file: string) => [
  paneColumn(folderPane, { dir }),
  paneColumn(previewPane, { path: `${dir}/${file}` }),
];

const shape = () =>
  store.getRoute().map((s) => ({ paneId: s.paneId, params: s.params }));
const ids = () => store.getRoute().map((s) => s.instanceId);

function seed(): void {
  store.restoreRoute([
    { paneId: "co-list", params: {} },
    { paneId: "co-folder", params: { dir: "/a" } },
    { paneId: "co-preview", params: { path: "/a/f" } },
  ]);
}

describe("computeColumnsOpen", () => {
  it("root: the route is the list", () => {
    seed();
    const next = computeColumnsOpen(
      store.getRoute(),
      undefined,
      pair("/b", "g"),
      {
        mode: "root",
      },
    );
    expect(next.changed).toBe(true);
    expect(next.route.map((s) => [s.paneId, s.params])).toEqual([
      ["co-folder", { dir: "/b" }],
      ["co-preview", { path: "/b/g" }],
    ]);
  });

  it("swap: the caller's column and what is right of it become the list", () => {
    seed();
    const route = store.getRoute();
    const next = computeColumnsOpen(
      route,
      route[1]!.instanceId,
      pair("/b", "g"),
      {
        mode: "swap",
      },
    );
    expect(next.route.map((s) => s.paneId)).toEqual([
      "co-list",
      "co-folder",
      "co-preview",
    ]);
    expect(next.route[0]).toBe(route[0]);
    expect(next.route[1]!.instanceId).not.toBe(route[1]!.instanceId);
  });

  it("swap with no caller in the route is root", () => {
    seed();
    const next = computeColumnsOpen(store.getRoute(), 9999, pair("/b", "g"), {
      mode: "swap",
    });
    expect(next.route.map((s) => s.paneId)).toEqual([
      "co-folder",
      "co-preview",
    ]);
  });

  it("inPlace keeps the instances standing where they stand", () => {
    seed();
    const route = store.getRoute();
    const next = computeColumnsOpen(
      route,
      route[1]!.instanceId,
      pair("/a/b", "g"),
      {
        mode: "swap",
        inPlace: true,
      },
    );
    expect(next.route.map((s) => s.instanceId)).toEqual(ids());
    expect(next.route[2]!.params).toEqual({ path: "/a/b/g" });
  });

  it("the list already on screen is no change", () => {
    seed();
    const route = store.getRoute();
    const next = computeColumnsOpen(
      route,
      route[1]!.instanceId,
      pair("/a", "f"),
      {
        mode: "swap",
      },
    );
    expect(next.changed).toBe(false);
    expect(next.route).toBe(route);
  });

  it("insert (⌥) keeps every column already there", () => {
    seed();
    const route = store.getRoute();
    const next = computeColumnsOpen(
      route,
      route[0]!.instanceId,
      pair("/b", "g"),
      {
        mode: "swap",
        insert: true,
      },
    );
    expect(next.route.map((s) => [s.paneId, s.params])).toEqual([
      ["co-list", {}],
      ["co-folder", { dir: "/b" }],
      ["co-preview", { path: "/b/g" }],
      ["co-folder", { dir: "/a" }],
      ["co-preview", { path: "/a/f" }],
    ]);
  });

  it("replace when asked, or when the last column keeps no history", () => {
    expect(
      computeColumnsOpen([], undefined, pair("/b", "g"), {
        mode: "root",
        replace: true,
      }).replace,
    ).toBe(true);
    expect(
      computeColumnsOpen([], undefined, pair("/b", "g"), { mode: "root" })
        .replace,
    ).toBe(false);
    expect(
      computeColumnsOpen(
        [],
        undefined,
        [
          paneColumn(folderPane, { dir: "/b" }),
          paneColumn(historylessPane, {}),
        ],
        { mode: "root" },
      ).replace,
    ).toBe(true);
  });

  it("an empty list throws", () => {
    expect(() =>
      computeColumnsOpen([], undefined, [], { mode: "root" }),
    ).toThrow(/empty/);
  });
});

describe("openPane.columns", () => {
  function mount(
    build: (open: OpenPaneFn) => LinkTarget,
    callerIndex?: number,
  ): () => LinkTarget {
    const seen: LinkTarget[] = [];
    function Probe({ onTarget }: { onTarget: (t: LinkTarget) => void }) {
      const target = build(useOpenPane());
      useEffect(() => {
        onTarget(target);
      });
      return null;
    }
    const callerInstanceId =
      callerIndex === undefined
        ? undefined
        : store.getRoute()[callerIndex]!.instanceId;
    render(
      <TestSurface store={store} plugins={plugins} basePath="/cols">
        <PaneInstanceContext.Provider value={callerInstanceId}>
          <Probe
            onTarget={(t) => {
              seen.push(t);
            }}
          />
        </PaneInstanceContext.Provider>
      </TestSurface>,
    );
    return () => seen.at(-1)!;
  }

  it("the href is where the plain click lands, the URL shortened", () => {
    seed();
    const target = mount(
      (open) => open.columns(pair("/b", "g"), { mode: "swap" }),
      1,
    );
    const href = target().href();
    expect(href).toBe("/cols/list/dir/%2Fb/pv/g");
    target().open(PLAIN_GESTURE);
    expect(window.location.pathname).toBe(href);
    expect(shape().map((s) => s.paneId)).toEqual([
      "co-list",
      "co-folder",
      "co-preview",
    ]);
  });

  it("a list headed by another app's pane goes to that app", () => {
    const navigated: string[] = [];
    const uninstall = appNavSink.install((url) => {
      navigated.push(url);
    });
    try {
      const target = mount((open) =>
        open.columns([paneColumn(guestPane, { g: "1" })], { mode: "root" }),
      );
      expect(target().href()).toBe("/other/guest/1");
      target().open(PLAIN_GESTURE);
      expect(navigated).toEqual(["/other/guest/1"]);
      expect(shape()).toEqual([]);
    } finally {
      uninstall();
    }
  });

  it("columnsLink spreads the same open", () => {
    seed();
    function Button() {
      const openPane = useOpenPane();
      return (
        <button
          type="button"
          {...openPane.columnsLink(pair("/c", "h"), { mode: "root" })}
        >
          open
        </button>
      );
    }
    const view = render(
      <TestSurface store={store} plugins={plugins} basePath="/cols">
        <Button />
      </TestSurface>,
    );
    fireEvent.click(view.getByRole("button"));
    expect(window.location.pathname).toBe("/cols/dir/%2Fc/pv/h");
  });
});
