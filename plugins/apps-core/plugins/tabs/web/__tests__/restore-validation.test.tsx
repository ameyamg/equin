import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, renderHook } from "@testing-library/react";

import {
  PluginProvider,
  markDeferredLoadComplete,
  type LoadedPlugin,
} from "@plugins/framework/plugins/web-sdk/core";
import { resetDeferredLoadStateForTests } from "@plugins/framework/plugins/web-sdk/core/testing";
import { appInstanceId } from "@plugins/primitives/plugins/scope/plugins/app-instance/web";
import { resetAppInstanceForTests } from "@plugins/primitives/plugins/scope/plugins/app-instance/web/testing";
import { Apps, setFocusedApp } from "@plugins/apps-core/web";
import {
  Pane,
  setLiveStore,
  useSyncPaneRegistry,
  type PaneStore,
} from "@plugins/primitives/plugins/pane/web";
import { defaultStore } from "@plugins/primitives/plugins/pane/web/testing";
import { defineApp, defineRoute } from "@plugins/primitives/plugins/pane/core";
import { symbol } from "@plugins/ui/plugins/icons/core";
import {
  bootTabs,
  TabsProvider,
  useTabs,
  type TabsApi,
} from "../internal/use-tabs";
import type { PersistedTabs } from "../internal/tabs-store";

// A SAVED TAB IS VALIDATED, NOT TRUSTED.
//
// A persisted tab holds its route verbatim, as the build that wrote it knew
// it. A later build may have removed the pane it names (Files' old
// `files-preview`, report-1795482864-g2gufb: "Unknown pane" thrown by the URL
// writer for every render of the tab bar) or made one of its params required.
// Such a route is put back to its URL instead — re-read by today's parser —
// and one naming a pane not registered YET is kept until the deferred tier
// settles, then judged again.

const pagesApp = defineApp({
  id: "pages",
  name: "Pages",
  basePath: "/pages",
  icon: symbol("home"),
});

/** `page/:id` — registered, `id` required. */
const pagePane = Pane.define({
  route: defineRoute({ id: "rv-page", segment: "page/:id" }),
  app: pagesApp,
  useResolve: false,
  component: () => null,
});

const plugins = [
  {
    id: "restore-validation-test-plugin",
    description: "restore validation fixture",
    contributions: [
      Apps.App({ app: pagesApp, component: () => null }),
      Pane.Register({ pane: pagePane }),
    ],
  } as unknown as LoadedPlugin,
];
const composition = { id: "test", home: "pages" };

type AppList = Parameters<typeof bootTabs>[0];
const APPS = [
  { id: "pages", app: pagesApp, component: () => null },
] as unknown as AppList;

/** Minimal in-memory Storage — jsdom's sessionStorage under vitest is inert. */
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(k: string) {
    return this.store.has(k) ? this.store.get(k)! : null;
  }
  key(i: number) {
    return [...this.store.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.store.delete(k);
  }
  setItem(k: string, v: string) {
    this.store.set(k, String(v));
  }
}

function persist(payload: PersistedTabs): void {
  window.sessionStorage.setItem(
    `s:apps-core.tabs:${appInstanceId()}`,
    JSON.stringify({ v: payload, ts: Date.now() }),
  );
}

/** A focused tab on `/pages` beside the background tab under test. */
function withBackground(tab: PersistedTabs["tabs"][number]): PersistedTabs {
  return {
    tabs: [{ tabId: "t-front", appId: "pages", route: [], rawPath: "" }, tab],
    focusedTabId: "t-front",
    mode: "",
  };
}

function backgroundState(
  tabId: string,
): ReturnType<PaneStore["getRouteState"]> {
  const boot = bootTabs(APPS, "pages");
  return boot.tabs.find((t) => t.tabId === tabId)!.store.getRouteState();
}

function RegistrySync() {
  useSyncPaneRegistry();
  return null;
}

beforeAll(() => {
  render(
    <PluginProvider plugins={plugins}>
      <RegistrySync />
    </PluginProvider>,
  );
  cleanup();
});

beforeEach(() => {
  const mem = new MemoryStorage();
  Object.defineProperty(window, "sessionStorage", {
    value: mem,
    configurable: true,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    value: mem,
    configurable: true,
  });
  resetAppInstanceForTests();
  window.history.replaceState(null, "", "/pages");
  resetDeferredLoadStateForTests();
  setFocusedApp(undefined);
});

afterEach(() => {
  cleanup();
  setFocusedApp(undefined);
  setLiveStore(defaultStore);
  window.history.replaceState(null, "", "/");
  resetDeferredLoadStateForTests();
});

describe("bootTabs — a persisted background tab", () => {
  it("a valid route restores as saved, its instances kept", () => {
    persist(
      withBackground({
        tabId: "t-bg",
        appId: "pages",
        route: [
          { paneId: "rv-page", params: { id: "abc" }, options: {}, uuid: "u1" },
        ],
        rawPath: "page/abc",
      }),
    );
    const state = backgroundState("t-bg");
    expect(state.kind).toBe("resolved");
    if (state.kind !== "resolved") return;
    expect(state.slots.map((s) => [s.paneId, s.params, s.uuid])).toEqual([
      ["rv-page", { id: "abc" }, "u1"],
    ]);
  });

  it("a slot lacking a param its pane requires restores pending from its URL", () => {
    persist(
      withBackground({
        tabId: "t-bg",
        appId: "pages",
        route: [{ paneId: "rv-page", params: {}, options: {}, uuid: "u1" }],
        rawPath: "page/abc",
      }),
    );
    expect(backgroundState("t-bg")).toEqual({
      kind: "unresolved",
      rawPath: "page/abc",
    });
  });

  it("a slot naming an unknown pane, once loading settled, restores pending from its URL", () => {
    markDeferredLoadComplete();
    persist(
      withBackground({
        tabId: "t-bg",
        appId: "pages",
        route: [
          {
            paneId: "files-preview",
            params: { open: "README.md" },
            options: {},
            uuid: "u1",
          },
        ],
        rawPath: "page/abc",
      }),
    );
    expect(backgroundState("t-bg")).toEqual({
      kind: "unresolved",
      rawPath: "page/abc",
    });
  });

  it("a slot naming a pane not registered yet (loading) is kept as saved", () => {
    persist(
      withBackground({
        tabId: "t-bg",
        appId: "pages",
        route: [{ paneId: "rv-later", params: {}, options: {}, uuid: "u1" }],
        rawPath: "later",
      }),
    );
    const state = backgroundState("t-bg");
    expect(state.kind === "resolved" && state.slots[0]?.paneId).toBe(
      "rv-later",
    );
  });
});

describe("bootTabs — the focused tab's instant restore", () => {
  it("a saved route lacking a required param re-reads the URL instead", () => {
    // The URL names no registered pane (branch 3: instant restore of the
    // persisted slots for this exact URL) — but the slots cannot stand.
    persist({
      tabs: [
        {
          tabId: "t1",
          appId: "pages",
          route: [{ paneId: "rv-page", params: {}, options: {}, uuid: "u1" }],
          rawPath: "legacy/x",
        },
      ],
      focusedTabId: "t1",
      mode: "",
    });
    window.history.replaceState(null, "", "/pages/legacy/x");
    const boot = bootTabs(APPS, "pages");
    const focused = boot.tabs.find((t) => t.tabId === boot.focusedTabId)!;
    expect(focused.store.getRouteState()).toEqual({
      kind: "unresolved",
      rawPath: "legacy/x",
    });
  });
});

describe("TabsProvider — re-checked once the deferred tier settles", () => {
  let hook!: { current: TabsApi };
  function mount() {
    const { result } = renderHook(() => useTabs(), {
      wrapper: ({ children }) => (
        <PluginProvider plugins={plugins} composition={composition}>
          <RegistrySync />
          <TabsProvider>{children}</TabsProvider>
        </PluginProvider>
      ),
    });
    hook = result;
  }
  const stateOf = (tabId: string) =>
    hook.current.tabs.find((t) => t.tabId === tabId)!.store.getRouteState();

  it("a kept slot whose pane never registered is re-read from its URL", () => {
    persist(
      withBackground({
        tabId: "t-bg",
        appId: "pages",
        // An old build's pane, gone — its tab's URL reads as today's page.
        route: [
          {
            paneId: "files-preview",
            params: { open: "README.md" },
            options: {},
            uuid: "u1",
          },
        ],
        rawPath: "page/abc",
      }),
    );
    mount();
    // Still loading: the pane may yet arrive, the saved route is kept.
    expect(stateOf("t-bg").kind).toBe("resolved");
    act(() => markDeferredLoadComplete());
    const state = stateOf("t-bg");
    expect(state.kind).toBe("resolved");
    if (state.kind !== "resolved") return;
    expect(state.slots.map((s) => [s.paneId, s.params])).toEqual([
      ["rv-page", { id: "abc" }],
    ]);
  });

  it("a dead one goes pending on its URL (the surface's not-found)", () => {
    persist(
      withBackground({
        tabId: "t-bg",
        appId: "pages",
        route: [{ paneId: "rv-gone", params: {}, options: {}, uuid: "u1" }],
        rawPath: "gone/x",
      }),
    );
    mount();
    act(() => markDeferredLoadComplete());
    expect(stateOf("t-bg")).toEqual({ kind: "unresolved", rawPath: "gone/x" });
  });
});

describe("bootTabs — the focused tab's pane instances across a reload", () => {
  /** The focused tab's slot uuids after a boot at the current URL. */
  function focusedUuids(): string[] | null {
    const boot = bootTabs(APPS, "pages");
    const state = boot.tabs
      .find((t) => t.tabId === boot.focusedTabId)!
      .store.getRouteState();
    return state.kind === "resolved" ? state.slots.map((s) => s.uuid) : null;
  }

  /** One tab, last seen on `page/now` (the persisted route). */
  function persistLastSeenElsewhere(): void {
    persist({
      tabs: [
        {
          tabId: "t1",
          appId: "pages",
          route: [
            {
              paneId: "rv-page",
              params: { id: "now" },
              options: {},
              uuid: "u-now",
            },
          ],
          rawPath: "page/now",
        },
      ],
      focusedTabId: "t1",
      mode: "",
    });
  }

  it("Back across a reload to an older entry: its panes keep the entry's uuids", () => {
    persistLastSeenElsewhere();
    // The older entry the browser lands on, as the shell adapter stamped it.
    window.history.replaceState(
      {
        tabId: "t1",
        appId: "pages",
        route: [
          {
            paneId: "rv-page",
            params: { id: "old" },
            options: {},
            uuid: "u-old",
          },
        ],
      },
      "",
      "/pages/page/old",
    );
    expect(focusedUuids()).toEqual(["u-old"]);
  });

  it("an entry saved by another tab lends it no instances", () => {
    persistLastSeenElsewhere();
    window.history.replaceState(
      {
        tabId: "t-other",
        appId: "pages",
        route: [
          {
            paneId: "rv-page",
            params: { id: "old" },
            options: {},
            uuid: "u-old",
          },
        ],
      },
      "",
      "/pages/page/old",
    );
    const uuids = focusedUuids();
    expect(uuids).toHaveLength(1);
    expect(uuids).not.toEqual(["u-old"]);
  });

  it("an entry slot of another pane or params is a new instance", () => {
    persistLastSeenElsewhere();
    window.history.replaceState(
      {
        tabId: "t1",
        appId: "pages",
        route: [
          {
            paneId: "rv-page",
            params: { id: "else" },
            options: {},
            uuid: "u-else",
          },
        ],
      },
      "",
      "/pages/page/old",
    );
    const uuids = focusedUuids();
    expect(uuids).toHaveLength(1);
    expect(uuids).not.toEqual(["u-else"]);
  });

  it("a plain reload with no route in the entry keeps the persisted tab's uuids", () => {
    persistLastSeenElsewhere();
    window.history.replaceState(null, "", "/pages/page/now");
    expect(focusedUuids()).toEqual(["u-now"]);
  });
});
