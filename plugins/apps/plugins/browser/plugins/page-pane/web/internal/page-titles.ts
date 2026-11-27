import { useEffect, useSyncExternalStore } from "react";
import { useBrowserTabs } from "@plugins/apps/plugins/browser/plugins/shell/web";

/**
 * The title each web-page pane's page last reported, by its remote page key.
 *
 * The pane's title hook (`title.useText`) is context-free — the tab bar, the
 * collapsed column and the document title call it outside the pane body — but
 * the page's title only reaches the body's own tab store. The body publishes
 * it here; the title hook reads it by the `;page` key in the URL. Entries are
 * kept after the pane unmounts, so a tab not kept mounted still shows its
 * page's title (one short string per page opened in this page load).
 */
const titles = new Map<string, string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setTitle(key: string, title: string): void {
  if (titles.get(key) === title) return;
  titles.set(key, title);
  for (const l of listeners) l();
}

/** The title the page `key` last reported (`""` when none yet). */
export function usePageTitle(key: string | undefined): string {
  const snapshot = () => (key === undefined ? "" : (titles.get(key) ?? ""));
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * Publishes the active tab's title under `key`. Mounted inside the pane's
 * `BrowserTabsStore.Provider`; renders nothing.
 */
export function PublishPageTitle({ pageKey }: { pageKey: string }): null {
  const { tabs } = useBrowserTabs();
  const title = tabs.find((t) => t.active)?.title ?? "";
  useEffect(() => {
    if (title !== "") setTitle(pageKey, title);
  }, [pageKey, title]);
  return null;
}
