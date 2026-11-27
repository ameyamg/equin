import {
  MediaRefSchema,
  type MediaRef,
} from "@plugins/fields/plugins/media/core";
import {
  formattedPlainText,
  formattedTextFieldType,
  parseFormattedText,
  plainFormattedText,
  type FormattedText,
} from "@plugins/fields/plugins/formatted-text/core";
import type { SiteFeedDecl } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";

/** An item's text as a post: the first `syndicate.text` value the title, the rest paragraphs. */
export interface SyndicatedText {
  title: string | null;
  paragraphs: FormattedText[];
}

/**
 * One `syndicate.text` value as formatted text: a formatted-text field's
 * markup read (bold, key caps, links — each target writes them its own way),
 * any other field's text taken as written, never read as markup.
 */
function formattedOf(
  feed: SiteFeedDecl,
  key: string,
  value: unknown,
): FormattedText {
  const text = typeof value === "string" ? value.trim() : "";
  return feed.fields[key]?.type.id === formattedTextFieldType.id
    ? parseFormattedText(text)
    : plainFormattedText(text);
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
  // A title is one plain line on every target: its formatting, if any, dropped.
  const title =
    first === undefined
      ? ""
      : formattedPlainText(formattedOf(feed, first, values[first]));
  return {
    title: title === "" ? null : title,
    paragraphs: rest
      .map((k) => formattedOf(feed, k, values[k]))
      .filter((t) => t.length > 0),
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
