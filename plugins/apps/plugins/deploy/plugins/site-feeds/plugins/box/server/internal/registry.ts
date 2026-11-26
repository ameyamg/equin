import { defineServerContribution } from "@plugins/framework/plugins/server-core/core";
import {
  asPluginId,
  type PluginId,
} from "@plugins/framework/plugins/plugin-id/core";
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

/** One feed this release declares, with the plugin that declared it. */
export interface SiteFeedServerDeclaration {
  readonly feed: SiteFeedDecl;
  /** The contribution's own stamp: what a deployment must ship to carry the feed. */
  readonly pluginId: PluginId;
}

/** The feed `feedId` this release declares, with its declaring plugin — or null. */
export function siteFeedDeclarationOf(
  feedId: string,
): SiteFeedServerDeclaration | null {
  const matches = SiteFeeds.Feed.getContributions().filter(
    (c) => c.feed.id === feedId,
  );
  if (matches.length > 1) {
    throw new Error(
      `site-feeds: feed "${feedId}" is contributed ${matches.length} times — a feed id is declared once`,
    );
  }
  const match = matches[0];
  if (match === undefined) return null;
  if (match._pluginId === undefined) {
    throw new Error(
      `site-feeds: the contribution of feed "${feedId}" carries no plugin id`,
    );
  }
  return { feed: match.feed, pluginId: asPluginId(match._pluginId) };
}

/** The feed `feedId` this release declares, or null when it declares none. */
export function siteFeedOf(feedId: string): SiteFeedDecl | null {
  return siteFeedDeclarationOf(feedId)?.feed ?? null;
}
