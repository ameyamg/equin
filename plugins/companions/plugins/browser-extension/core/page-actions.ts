import type { AvatarColor } from "@plugins/primitives/plugins/avatar/core";
import type { SymbolRef } from "@plugins/ui/plugins/icons/core";

/** The site a page action belongs to: its section's title, and which pages it is on. */
export interface PageActionSite {
  /** The section title ("equin.ai"); actions sharing a label share a section. */
  label: string;
  matches: (url: URL) => boolean;
}

/** What a page action may ask of the extension. */
export interface PageActionHost {
  /** Load `url` in the tab the popup is about. */
  navigate: (url: string) => Promise<void>;
  /** Open `url` in a new tab — behind the current one with `background`. */
  openTab: (url: string, opts?: { background?: boolean }) => Promise<void>;
}

interface PageActionBase {
  id: string;
  site: PageActionSite;
  /** The tile: a glyph on a gradient of one categorical colour. */
  icon: { symbol: SymbolRef; color: AvatarColor };
  title: string;
}

/**
 * An action that goes somewhere: the panel owns what that means — a click
 * loads the destination in the tab the popup is about, ⌘/Ctrl- or
 * middle-click opens it in a new tab (what the same gesture does on a link),
 * and the row's subtitle is the destination itself.
 */
export interface PageLinkAction extends PageActionBase {
  kind: "link";
  /** Where the action goes from `url` (called only where `site` matches). */
  href: (url: URL) => string;
}

/** An action that does something other than going somewhere. */
export interface PageRunAction extends PageActionBase {
  kind: "run";
  subtitle: (url: URL) => string;
  run: (url: URL, host: PageActionHost) => Promise<void>;
}

/**
 * An action the extension offers on a page it matches, contributed by the app
 * that owns what it does (`BrowserExtension.PageAction`): a gradient tile, a
 * title and a subtitle, run on a click or its ⌘N.
 */
export type PageAction = PageLinkAction | PageRunAction;

/** One section of page actions: a site, and its actions on this page. */
export interface PageActionGroup<A> {
  label: string;
  actions: readonly A[];
}

/**
 * The actions that match `url`, grouped by their site's label — groups in the
 * order their first action comes, actions in the order given (the slot's).
 */
export function groupPageActions<A extends Pick<PageAction, "site">>(
  actions: readonly A[],
  url: URL,
): PageActionGroup<A>[] {
  const groups = new Map<string, A[]>();
  for (const action of actions) {
    if (!action.site.matches(url)) continue;
    const group = groups.get(action.site.label);
    if (group === undefined) groups.set(action.site.label, [action]);
    else group.push(action);
  }
  return [...groups].map(([label, list]) => ({ label, actions: list }));
}
