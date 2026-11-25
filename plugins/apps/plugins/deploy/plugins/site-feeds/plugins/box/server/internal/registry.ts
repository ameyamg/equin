import { defineServerContribution } from "@plugins/framework/plugins/server-core/core";
import type { SiteFeedDecl } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";

/** What a site plugin contributes: one feed it declares. */
export interface SiteFeedContribution {
  readonly feed: SiteFeedDecl;
}

/**
 * The feeds this box serves. A site plugin's `server/` contributes the SAME
 * declaration its `web/` contributes to the web slot — `SiteFeeds.Feed({ feed })`.
 * Read only through {@link siteFeedOf}: nothing here names a feed.
 */
export const SiteFeeds = {
  Feed: defineServerContribution<SiteFeedContribution>("site-feeds.feed", {
    docLabel: (c) => c.feed.id,
  }),
};

/** The feed `feedId` this release declares, or null when it declares none. */
export function siteFeedOf(feedId: string): SiteFeedDecl | null {
  const matches = SiteFeeds.Feed.getContributions().filter(
    (c) => c.feed.id === feedId,
  );
  if (matches.length > 1) {
    throw new Error(
      `site-feeds: feed "${feedId}" is contributed ${matches.length} times — a feed id is declared once`,
    );
  }
  return matches[0]?.feed ?? null;
}
