import { PUBLIC_SITE_ORIGIN } from "@plugins/apps/plugins/website/plugins/shell/core";
import { symbol } from "@plugins/ui/plugins/icons/core";
import type { PageAction } from "@plugins/companions/plugins/browser-extension/core";
import { pagePort } from "@plugins/infra/plugins/launcher/plugins/gateway-port/core";
import { MAIN_WORKTREE_NAME } from "@plugins/infra/plugins/namespace/core";
import {
  flipView,
  formatEquinAddress,
  mainInstance,
  moveInstance,
  parseEquinAddress,
  sameInstance,
  type EquinAddress,
  type EquinInstance,
} from "../../core";

// Every equin page is an instance (a worktree, main, equin.ai) × a view (an
// app, the demo of it, a site page). Each action below moves ONE axis and
// keeps the other, so a page offers at most three rows — never one per
// destination — and a diagonal (a worktree's app → main's demo) is two hops.

const publicHost = new URL(PUBLIC_SITE_ORIGIN).hostname;
/**
 * The local gateway's port: the panel's own — the popup frames it from the
 * local gateway, so the page's location names this account's port. Only for
 * a move from equin.ai, which cannot name one; a local page keeps its own.
 */
const localPort = (): number => pagePort(window.location);

/** The section every equin action shares: rows that each move one axis. */
const SITE_LABEL = "equin";

/** An action from `move`'s destination: shown only where `move` has one. */
function moveAction(
  spec: Omit<PageAction, "site" | "subtitle" | "run">,
  move: (here: EquinAddress) => EquinAddress | null,
): PageAction {
  const destination = (url: URL): string | null => {
    const here = parseEquinAddress(url);
    const there = here === null ? null : move(here);
    return there === null ? null : formatEquinAddress(there);
  };
  return {
    ...spec,
    site: { label: SITE_LABEL, matches: (url) => destination(url) !== null },
    // The row says where it goes: the scheme is noise in a 300px popup.
    subtitle: (url) => (destination(url) ?? "").replace(/^https?:\/\//, ""),
    run: async (url, host) => {
      const href = destination(url);
      if (href === null) throw new Error(`${url.href} has no destination`);
      await host.navigate(href);
    },
  };
}

/** `here` on `instance`, or `null` when it is already there. */
function moveTo(
  here: EquinAddress,
  instance: EquinInstance,
): EquinAddress | null {
  return sameInstance(here.instance, instance)
    ? null
    : moveInstance(here, instance);
}

const swapIcon = { symbol: symbol("swap-horiz"), color: "indigo" } as const;

/** On a worktree's page: the same page on main. */
export const openOnMain = moveAction(
  { id: "open-on-main", icon: swapIcon, title: "Open on main" },
  (here) =>
    here.instance.kind === "local" &&
    here.instance.namespace !== MAIN_WORKTREE_NAME
      ? moveTo(here, mainInstance(here.instance.port))
      : null,
);

/** On equin.ai: the same page on the local instance. */
export const openLocally = moveAction(
  { id: "open-locally", icon: swapIcon, title: "Open locally" },
  (here) =>
    here.instance.kind === "public"
      ? moveTo(here, mainInstance(localPort()))
      : null,
);

/** On a local page: the same page on equin.ai (an app page in its demo). */
export const openOnPublicSite = moveAction(
  { id: "open-on-public-site", icon: swapIcon, title: `Open on ${publicHost}` },
  (here) =>
    here.instance.kind === "local" ? moveTo(here, { kind: "public" }) : null,
);

/** On an app page: the demo, at the same place. */
export const openInDemo = moveAction(
  {
    id: "open-in-demo",
    icon: { symbol: symbol("play-circle"), color: "teal" },
    title: "Open in the demo",
  },
  (here) => (here.view.kind === "app" ? flipView(here, localPort()) : null),
);

/** In the demo: the real app at the same place (on main, from equin.ai). */
export const openLive = moveAction(
  {
    id: "open-live",
    icon: { symbol: symbol("bolt"), color: "amber" },
    title: "Open live",
  },
  (here) => (here.view.kind === "demo" ? flipView(here, localPort()) : null),
);
