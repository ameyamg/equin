import {
  LINK_PLACEMENT_ATTRIBUTE,
  OUTBOUND_CLICK_EVENT,
  UNPLACED_LINK,
  outboundClick,
  type OutboundDestinationOf,
} from "../../core";

/** What the mounted `<AnalyticsTracker />` says about outbound links. */
export interface OutboundScope {
  /** Only clicks while the address is under this app count (`isWithinApp`). */
  inScope: () => boolean;
  destinationOf: OutboundDestinationOf;
}

export interface OutboundDeps {
  /** The scope of the tracker that installed the listener. */
  scope: OutboundScope;
  /** The page's URL now (`location.href`). */
  pageUrl: () => string;
  /** The page path the click is recorded on. */
  path: () => string;
  /** The innermost registered page section around `el` on `path`, or null. */
  sectionOf: (path: string, el: Element) => string | null;
  track: (name: string, props: Record<string, string>) => void;
}

/** The link a click landed on: the first anchor / area with an `href` on its path. */
function linkOf(event: Event): HTMLAnchorElement | HTMLAreaElement | null {
  for (const node of event.composedPath()) {
    if (
      (node instanceof HTMLAnchorElement || node instanceof HTMLAreaElement) &&
      node.hasAttribute("href")
    )
      return node;
  }
  return null;
}

/** The link's placement: the nearest `data-link-placement`, else its page section. */
function placementOf(
  link: Element,
  path: string,
  sectionOf: OutboundDeps["sectionOf"],
): string {
  const named = link
    .closest(`[${LINK_PLACEMENT_ATTRIBUTE}]`)
    ?.getAttribute(LINK_PLACEMENT_ATTRIBUTE);
  return named ?? sectionOf(path, link) ?? UNPLACED_LINK;
}

/**
 * The ONE listener that records every click on a link leaving the site
 * (`outbound_click`): delegated on the document in the capture phase, so it
 * sees every anchor — present, added later, rendered by any component or from
 * content — before any handler of the link's own can stop the event. No link
 * has to opt in, so none can skip it.
 *
 * A primary click (`click`, which a keyboard Enter also fires) and a middle
 * click (`auxclick`, button 1 — a new tab) count; a context-menu "open in new
 * tab" is not seen by the page. The event goes out on the collector's
 * `keepalive` send, so it still arrives when the click navigates the page
 * away. Returns the uninstall.
 */
export function watchOutboundLinks(
  target: Pick<Document, "addEventListener" | "removeEventListener">,
  deps: OutboundDeps,
): () => void {
  const onClick = (event: MouseEvent) => {
    if (event.type === "auxclick" && event.button !== 1) return;
    const { scope } = deps;
    if (!scope.inScope()) return;
    const link = linkOf(event);
    if (link === null) return;
    const path = deps.path();
    const click = outboundClick({
      href: link.href,
      pageUrl: deps.pageUrl(),
      path,
      placement: placementOf(link, path, deps.sectionOf),
      destinationOf: scope.destinationOf,
    });
    if (click.outbound) deps.track(OUTBOUND_CLICK_EVENT, click.props);
  };
  target.addEventListener("click", onClick, { capture: true });
  target.addEventListener("auxclick", onClick, { capture: true });
  return () => {
    target.removeEventListener("click", onClick, { capture: true });
    target.removeEventListener("auxclick", onClick, { capture: true });
  };
}
