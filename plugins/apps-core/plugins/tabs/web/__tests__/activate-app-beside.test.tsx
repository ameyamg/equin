import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";

import {
  PluginProvider,
  type LoadedPlugin,
} from "@plugins/framework/plugins/web-sdk/core";
import { Apps, setFocusedApp } from "@plugins/apps-core/web";
import {
  Pane,
  setLiveStore,
  useSyncPaneRegistry,
} from "@plugins/primitives/plugins/pane/web";
import { defineApp, defineRoute } from "@plugins/primitives/plugins/pane/core";
import { defaultStore } from "@plugins/primitives/plugins/pane/web/testing";
import {
  PLAIN_GESTURE,
  runActivation,
  type Gesture,
} from "@plugins/primitives/plugins/link-gesture/core";
import { TabsProvider, useTabs } from "../internal/use-tabs";
import { useActivateApp } from "../internal/use-activate-app";
import { pagePlacementRegistry } from "../internal/placement-registry";
import { symbol } from "@plugins/ui/plugins/icons/core";

// ⌥-CLICK AN APP: OPEN IT BESIDE WHAT IS ON SCREEN.
//
// `useActivateApp` with `{ keepOthers: true }` on a tab app that declares a
// navigator column (its one `opensInPlace` pane) inserts that column into the
// focused tab's route, after the panes already there — the tab stays on its
// app. An app with no navigator column switches as a plain click does, and a
// plain click always switches.

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

const pagesApp = defineApp({
  id: "pages",
  name: "Pages",
  basePath: "/pages",
  icon: symbol("home"),
});
const storyApp = defineApp({
  id: "story",
  name: "Story",
  basePath: "/story",
  icon: symbol("home"),
});
const plainApp = defineApp({
  id: "plain",
  name: "Plain",
  basePath: "/plain",
  icon: symbol("home"),
});

const pagesPagePane = Pane.define({
  route: defineRoute({ id: "beside-pages-page", segment: "p/:id" }),
  app: pagesApp,
  useResolve: false,
  component: () => null,
});
// Story's navigator column: parentless, a static segment, opensInPlace.
const storyNavPane = Pane.define({
  route: defineRoute({ id: "beside-story-nav", segment: "story-nav" }),
  app: storyApp,
  opensInPlace: true,
  component: () => null,
});

const plugin = {
  id: "tabs-activate-beside-test",
  description: "fake apps + a navigator column for the ⌥-activate suite",
  contributions: [
    Apps.App({ app: pagesApp, component: () => null }),
    Apps.App({ app: storyApp, component: () => null }),
    Apps.App({ app: plainApp, component: () => null }),
    Pane.Register({ pane: pagesPagePane }),
    Pane.Register({ pane: storyNavPane }),
  ],
} as unknown as LoadedPlugin;

const composition = { id: "test", home: "pages" };

function RegistrySync() {
  useSyncPaneRegistry();
  return null;
}

function useHarness() {
  return { tabs: useTabs(), activate: useActivateApp() };
}

async function mount() {
  const rendered = renderHook(() => useHarness(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <PluginProvider plugins={[plugin]} composition={composition}>
        <RegistrySync />
        <TabsProvider>{children}</TabsProvider>
      </PluginProvider>
    ),
  });
  await act(async () => {});
  return rendered.result;
}

type Hook = { current: ReturnType<typeof useHarness> };

function focused(hook: Hook) {
  const { tabs, focusedTabId } = hook.current.tabs;
  const tab = tabs.find((t) => t.tabId === focusedTabId)!;
  return {
    appId: tab.appId,
    route: tab.store.getRoute().map((s) => [s.paneId, s.params]),
  };
}

async function activate(
  hook: Hook,
  app: typeof storyApp,
  gesture: Gesture,
): Promise<void> {
  await act(async () => {
    runActivation(
      hook.current.activate({ id: app.id, app, surfaceMode: undefined }),
      gesture,
    );
  });
}

const KEEP_OTHERS: Gesture = { keepOthers: true };

let uninstallPlacements: () => void;

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
  setFocusedApp(undefined);
  window.history.replaceState(null, "", "/pages/p/1");
  uninstallPlacements = pagePlacementRegistry.install({
    defaultId: "docked",
    ids: new Set(["docked"]),
    newTabFollows: new Set(),
    appThemeScope: new Set(),
    ownsChrome: new Set(),
    allowsEmpty: new Set(),
    showsUnfocused: new Set(),
  });
});

afterEach(() => {
  cleanup();
  uninstallPlacements();
  setFocusedApp(undefined);
  setLiveStore(defaultStore);
  window.history.replaceState(null, "", "/");
});

describe("useActivateApp with ⌥ (keepOthers)", () => {
  it("opens the app's navigator column beside the focused tab's panes; the tab keeps its app", async () => {
    const hook = await mount();
    expect(focused(hook)).toEqual({
      appId: "pages",
      route: [["beside-pages-page", { id: "1" }]],
    });

    await activate(hook, storyApp, KEEP_OTHERS);

    expect(focused(hook)).toEqual({
      appId: "pages",
      route: [
        ["beside-pages-page", { id: "1" }],
        ["beside-story-nav", {}],
      ],
    });
    expect(hook.current.tabs.tabs.map((t) => t.appId)).toEqual(["pages"]);
  });

  it("an app with no navigator column switches the tab, as a plain click does", async () => {
    const hook = await mount();

    await activate(hook, plainApp, KEEP_OTHERS);

    expect(focused(hook).appId).toBe("plain");
    expect(window.location.pathname).toBe("/plain");
  });
});

describe("useActivateApp with a plain click", () => {
  it("switches to an app even when it has a navigator column", async () => {
    const hook = await mount();

    await activate(hook, storyApp, PLAIN_GESTURE);

    expect(focused(hook).appId).toBe("story");
    expect(window.location.pathname).toBe("/story");
  });
});
