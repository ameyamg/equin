import {
  MediaRefSchema,
  type MediaRef,
} from "@plugins/fields/plugins/media/core";
import type { SiteFeedDecl } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";

/** An item's text as a post: the first `syndicate.text` value the title, the rest paragraphs. */
export interface SyndicatedText {
  title: string | null;
  paragraphs: string[];
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The text of an item's post, read through its feed's `syndicate` — null for
 * a feed that declares none (it is never posted elsewhere).
 */
export function syndicatedText(
  feed: SiteFeedDecl,
  values: Readonly<Record<string, unknown>>,
): SyndicatedText | null {
  if (feed.syndicate === undefined) return null;
  const [first, ...rest] = feed.syndicate.text;
  const title = first === undefined ? "" : textOf(values[first]);
  return {
    title: title === "" ? null : title,
    paragraphs: rest.map((k) => textOf(values[k])).filter((t) => t !== ""),
  };
}

/** The files of an item's post: its `syndicate.media` field's refs, in order. */
export function syndicatedMediaRefs(
  feed: SiteFeedDecl,
  values: Readonly<Record<string, unknown>>,
): MediaRef[] {
  const key = feed.syndicate?.media;
  if (key === undefined) return [];
  return MediaRefSchema.array().parse(values[key] ?? []);
}

/**
 * Where the site shows the feed: its first hostname plus the feed's
 * `pagePath` (the root when it declares none). Null for a site with no
 * hostname — reachable only on its server.
 */
export function feedPageUrl(
  hostnames: readonly string[],
  pagePath: string | undefined,
): string | null {
  const host = hostnames.find((h) => !h.startsWith("*."));
  return host === undefined ? null : `https://${host}${pagePath ?? "/"}`;
}
