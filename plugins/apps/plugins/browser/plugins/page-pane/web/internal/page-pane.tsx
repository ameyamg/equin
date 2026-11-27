import { useState } from "react";
import {
  Pane,
  PaneChrome,
  defineRoute,
  useOpenPane,
} from "@plugins/primitives/plugins/pane/web";
import { parseUrl } from "@plugins/packages/plugins/floor-compat/core";
import type { LinkTarget } from "@plugins/primitives/plugins/link-gesture/core";
import { browserApp } from "@plugins/apps/plugins/browser/plugins/shell/core";
import {
  Browser,
  BrowserTabsStore,
  BrowserToolbar,
  singlePageTabs,
  useBrowserTabs,
} from "@plugins/apps/plugins/browser/plugins/shell/web";
import { Clip } from "@plugins/primitives/plugins/css/plugins/clip/web";
import { rigidClass } from "@plugins/primitives/plugins/css/plugins/rigid/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { cn } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { PublishPageTitle, usePageTitle } from "./page-titles";

/**
 * A web page beside the pane that linked to it, in the Browser's own
 * rendering: its page in the engine's Chromium, with the browser's toolbar.
 *
 * - `url` — the page the link named, as ONE encoded segment; where the page is
 *   (re)created when the host no longer holds it.
 * - `;page` — the remote page's key on the engine host. In the URL so a reload
 *   of this tab re-attaches the same live page (its history, scroll, sign-in
 *   form) rather than loading `url` afresh. A pane nobody shows lets its page
 *   go: the host freezes it after a minute and closes it after 30 (engine's
 *   host-pages).
 *
 * Titled by the page's own title once it reports one (its host until then).
 * No Expand (`promote: false`): the toolbar's "Open in system browser" is the
 * way out, and a second "open elsewhere" beside it read as the same thing.
 */
export const webPagePane = Pane.define({
  route: defineRoute({ id: "web-page", segment: "web/:url;page" }),
  app: browserApp,
  component: WebPagePaneBody,
  title: { useText: usePaneTitleText },
  chrome: { history: false, promote: false },
  useResolve: false,
});

/** The page's reported title, else its host. */
function usePaneTitleText({ url, page }: { url: string; page?: string }) {
  const title = usePageTitle(page);
  return title !== "" ? title : hostOf(url);
}

/** The page's host, for the pane's title (the whole URL when it has none). */
function hostOf(url: string): string {
  return parseUrl(url)?.host || url;
}

function WebPagePaneBody() {
  const { url, page } = webPagePane.useParams();
  // An old link without a key gets one for this mount (it re-attaches nothing).
  const [key] = useState(() => page ?? crypto.randomUUID());
  return (
    <BrowserTabsStore.Provider initial={() => singlePageTabs({ key, url })}>
      <PublishPageTitle pageKey={key} />
      <PaneChrome pane={webPagePane}>
        <WebPageView />
      </PaneChrome>
    </BrowserTabsStore.Provider>
  );
}

/**
 * The browser's toolbar over its viewport. The tab strip shows only when the
 * page opened a popup (a second tab here), so it can be switched back.
 */
function WebPageView() {
  const { tabs } = useBrowserTabs();
  return (
    <Stack gap="none" className="h-full">
      {tabs.length > 1 && (
        <div className={cn("border-b", rigidClass())}>
          <Browser.TabStrip.Render />
        </div>
      )}
      <div className={cn("border-b", rigidClass())}>
        <BrowserToolbar />
      </div>
      <Clip as="main" fill>
        <Browser.Viewport.Render />
      </Clip>
      <Browser.Effects.Mount />
    </Stack>
  );
}

/**
 * Opens `url` in the web-page pane beside the caller, as DATA: a plain click
 * opens the pane (a fresh remote page); the "elsewhere" gestures go to `url`
 * itself — on a real `<a href={url}>` they are left to the browser, so ⌘- and
 * middle-click open the site in a new browser tab, as on any web link.
 */
export function useWebPageLink(): (url: string) => LinkTarget {
  const openPane = useOpenPane();
  return (url) => ({
    open: (gesture) =>
      openPane
        .to(webPagePane, { url, page: crypto.randomUUID() }, { mode: "push" })
        .open(gesture),
    href: () => url,
  });
}
