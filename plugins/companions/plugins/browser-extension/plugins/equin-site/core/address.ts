import {
  isLocalAppUrl,
  isPublicSiteUrl,
  publicSitePageUrl,
  publicSiteRoutePath,
} from "@plugins/apps/plugins/website/plugins/shell/core";
import { WEBSITE_BASE_PATH } from "@plugins/apps/plugins/website/plugins/crawlable/core";
import {
  demoPage,
  demoPagePath,
} from "@plugins/apps/plugins/website/plugins/live-demo/core";
import { readEmbedTail } from "@plugins/primitives/plugins/pane/core";
import {
  MAIN_WORKTREE_NAME,
  namespaceFromHost,
  namespaceUrl,
  type Namespace,
} from "@plugins/infra/plugins/namespace/core";
import { pagePort } from "@plugins/infra/plugins/launcher/plugins/gateway-port/core";

/**
 * Where an equin page is served: the published site, or a namespace (main or
 * a worktree) behind the local gateway on `port`.
 */
export type EquinInstance =
  { kind: "public" } | { kind: "local"; namespace: Namespace; port: number };

/**
 * What an equin page shows, independent of where it is served:
 * - `app`: an app's own page (`/isle`) — only a local instance serves one;
 * - `demo`: the in-browser live demo at an app place (`/about/demo/at/isle`);
 * - `site`: any other website page (`/about/vision`), its route path.
 */
export type EquinView =
  | { kind: "app"; place: string }
  | { kind: "demo"; place: string }
  | { kind: "site"; path: string };

/**
 * An equin page as two independent axes — the instance and the view — plus
 * the query and hash it carries. Every conversion the extension offers moves
 * one axis and keeps the other, so N destinations never need N×M rows.
 */
export interface EquinAddress {
  instance: EquinInstance;
  view: EquinView;
  /** `?…#…`, kept as it stands across a move. */
  suffix: string;
}

/** `url` read as an equin address, or `null` for a page no equin serves. */
export function parseEquinAddress(url: URL): EquinAddress | null {
  const suffix = url.search + url.hash;
  if (isPublicSiteUrl(url)) {
    // The published site serves the website app at `/`: its route path is
    // read as the gateway reads it (an address, or the route's own spelling).
    const view = viewOfSitePath(publicSiteRoutePath(url.pathname));
    return { instance: { kind: "public" }, view, suffix };
  }
  if (!isLocalAppUrl(url)) return null;
  const namespace = namespaceFromHost(url.host);
  if (namespace === null) return null;
  const instance = { kind: "local", namespace, port: pagePort(url) } as const;
  const isSite =
    url.pathname === WEBSITE_BASE_PATH ||
    url.pathname.startsWith(`${WEBSITE_BASE_PATH}/`);
  const view: EquinView = isSite
    ? viewOfSitePath(url.pathname)
    : { kind: "app", place: url.pathname };
  return { instance, view, suffix };
}

/** A website route path: the demo page (at its embed place), or a site page. */
function viewOfSitePath(path: string): EquinView {
  if (path === demoPage.path) return { kind: "demo", place: "/" };
  const prefix = `${demoPage.path}/`;
  if (path.startsWith(prefix)) {
    const parts = path.slice(prefix.length).split("/");
    const tail = readEmbedTail(parts, 0);
    const place = tail === null ? undefined : Object.values(tail)[0];
    if (place !== undefined) return { kind: "demo", place };
  }
  return { kind: "site", path };
}

/** The route path a view is drawn at (an app's place, or a website page). */
function routePath(view: EquinView): string {
  switch (view.kind) {
    case "app":
      return view.place;
    case "demo":
      return demoPagePath(view.place);
    case "site":
      return view.path;
  }
}

/**
 * The URL of `address`. Throws for an app page on the published site: it
 * serves only the website — {@link moveInstance} turns one into the demo.
 */
export function formatEquinAddress(address: EquinAddress): string {
  const { instance, view, suffix } = address;
  if (instance.kind === "public") {
    if (view.kind === "app")
      throw new Error(
        `the published site has no app pages (${view.place}); open its demo`,
      );
    return publicSitePageUrl(routePath(view) + suffix);
  }
  return namespaceUrl(
    instance.namespace,
    routePath(view) + suffix,
    instance.port,
  );
}

/** The main namespace, on `port`. */
export function mainInstance(port: number): EquinInstance {
  return { kind: "local", namespace: MAIN_WORKTREE_NAME, port };
}

/** Whether two instances are the same one. */
export function sameInstance(a: EquinInstance, b: EquinInstance): boolean {
  if (a.kind === "public" || b.kind === "public") return a.kind === b.kind;
  return a.namespace === b.namespace && a.port === b.port;
}

/**
 * `address` on `instance`, its view kept — but an app page moved to the
 * published site, which serves no app, opens in its demo at the same place.
 */
export function moveInstance(
  address: EquinAddress,
  instance: EquinInstance,
): EquinAddress {
  const view: EquinView =
    instance.kind === "public" && address.view.kind === "app"
      ? { kind: "demo", place: address.view.place }
      : address.view;
  return { ...address, instance, view };
}

/**
 * `address` flipped between its app and the demo of it, at the same place —
 * `null` for a site page, which has no app. The published site has no live
 * app, so its demo opens live on main (on `localPort`).
 */
export function flipView(
  address: EquinAddress,
  localPort: number,
): EquinAddress | null {
  const { view, instance } = address;
  switch (view.kind) {
    case "site":
      return null;
    case "app":
      return { ...address, view: { kind: "demo", place: view.place } };
    case "demo":
      return {
        ...address,
        instance:
          instance.kind === "public" ? mainInstance(localPort) : instance,
        view: { kind: "app", place: view.place },
      };
  }
}
