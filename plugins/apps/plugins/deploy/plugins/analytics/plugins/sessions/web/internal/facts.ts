import type { Session } from "@plugins/apps/plugins/deploy/plugins/analytics/plugins/collect/core";
import { countryName } from "./format";

/**
 * Where the visit came from: the referring page (`news.ycombinator.com/item`,
 * the bare host when the referrer sent only its root — as Facebook, Google and
 * most sites do), else its campaign source, else "Direct". The query string is
 * never stored, so this is all of the referrer there is.
 */
export function sourceOf(s: Session): string {
  if (s.referrerHost !== null) {
    return s.referrerPath === null || s.referrerPath === "/"
      ? s.referrerHost
      : `${s.referrerHost}${s.referrerPath}`;
  }
  return s.utmSource ?? "Direct";
}

/** "macOS · Chrome · from github.com" — the row's second line. */
export function softwareLine(s: Session): string {
  return `${s.os} · ${s.browser} · from ${sourceOf(s)}`;
}

/**
 * Made-up visits' search text (the exhibit's), in the words its rows show —
 * a site's visit carries collect's own (`visitSearchText`, run in SQL), so
 * this is never what a site's list searches.
 */
export function madeUpSearchText(s: Session): string {
  return [
    s.country ?? "",
    countryName(s.country),
    sourceOf(s),
    s.channel,
    s.device,
    s.os,
    s.browser,
    ...s.pages,
  ].join(" ");
}
