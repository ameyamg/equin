import { parseUrl } from "@plugins/packages/plugins/floor-compat/core";
import { MarkdownExtensions, type WebLinkProps } from "../slots";

/**
 * Whether `href` is a site on the web: an absolute http(s) URL on another
 * origin. A link to this app's own origin is not — it is equin itself (a pane,
 * an `/api` file).
 */
export function isWebUrl(href: string | undefined): boolean {
  if (href === undefined || !/^https?:\/\//i.test(href)) return false;
  return parseUrl(href)?.origin !== window.location.origin;
}

/**
 * A web link in the transcript, drawn by the `MarkdownExtensions.WebLink`
 * contribution (the Browser's: a plain click opens its web-page side pane),
 * else a plain link opening the site in a new browser tab.
 */
export function WebLink(props: WebLinkProps) {
  return <MarkdownExtensions.WebLink.Dispatch {...props} />;
}
