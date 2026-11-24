import { MAX_EVENT_PROP_VALUE_LENGTH } from "./collect-body";

/**
 * The event every click on a link that leaves the site records — sent by the
 * tracker's ONE delegated click listener (`web/internal/outbound.ts`), never by
 * the link itself, so no link can skip it.
 */
export const OUTBOUND_CLICK_EVENT = "outbound_click";

/** The props of {@link OUTBOUND_CLICK_EVENT}, each a key of its `event_prop` breakdown. */
export const OUTBOUND_PROPS = {
  /** Where it goes: the site's name for the destination (`github_repo`, `discord`), else the URL's host. */
  to: "to",
  /** The page it was clicked on (the hit's own path, repeated so the event breaks down by it). */
  page: "page",
  /** Which link: its placement (see {@link LINK_PLACEMENT_ATTRIBUTE}). */
  link: "link",
} as const;

/**
 * Names a link's placement — `header_github`, `contact_discord`. Set on the
 * anchor or any ancestor; the nearest wins. A link without one is named by the
 * page section it sits in (`landing/contact`), else {@link UNPLACED_LINK}: it
 * is still counted, and the dashboard shows the gap.
 */
export const LINK_PLACEMENT_ATTRIBUTE = "data-link-placement";
export const LINK_PLACEMENT_PATTERN = /^[a-z0-9_/]{1,64}$/;
export const UNPLACED_LINK = "(unplaced)";

/** The props spread on a link (or its container) to name its placement. */
export function linkPlacement(name: string): {
  [LINK_PLACEMENT_ATTRIBUTE]: string;
} {
  if (!LINK_PLACEMENT_PATTERN.test(name))
    throw new Error(
      `[analytics] link placement ${JSON.stringify(name)} must match ${String(LINK_PLACEMENT_PATTERN)}`,
    );
  return { [LINK_PLACEMENT_ATTRIBUTE]: name };
}

/**
 * A site's names for its destinations: `github_issues` for the repository's
 * new-issue page rather than `github.com`. Undefined = not one of them, so
 * the host names it.
 */
export type OutboundDestinationOf = (url: URL) => string | undefined;

export type OutboundClickProps = Record<
  (typeof OUTBOUND_PROPS)[keyof typeof OUTBOUND_PROPS],
  string
>;

export type OutboundClick =
  { outbound: true; props: OutboundClickProps } | { outbound: false };

/**
 * What a click on a link to `href` records. A link that stays on the site
 * (same host) or is not a web address (`mailto:`, `#section`) is not outbound.
 * A prop value is cut to the collector's bound: a 200-character host is still
 * a click on it.
 */
export function outboundClick({
  href,
  pageUrl,
  path,
  placement,
  destinationOf,
}: {
  /** The link's `href` as the browser resolved it (`HTMLAnchorElement.href`). */
  href: string;
  /** The page's URL, which a relative `href` resolves against. */
  pageUrl: string;
  /** The page path the click is recorded on. */
  path: string;
  placement: string;
  destinationOf: OutboundDestinationOf;
}): OutboundClick {
  let url: URL;
  try {
    url = new URL(href, pageUrl);
  } catch (err) {
    // An `href` the browser itself cannot resolve navigates nowhere.
    if (err instanceof TypeError) return { outbound: false };
    throw err;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return { outbound: false };
  if (url.host === new URL(pageUrl).host) return { outbound: false };
  const cut = (v: string) => v.slice(0, MAX_EVENT_PROP_VALUE_LENGTH);
  return {
    outbound: true,
    props: {
      [OUTBOUND_PROPS.to]: cut(destinationOf(url) ?? url.host),
      [OUTBOUND_PROPS.page]: cut(path),
      [OUTBOUND_PROPS.link]: cut(placement),
    },
  };
}
