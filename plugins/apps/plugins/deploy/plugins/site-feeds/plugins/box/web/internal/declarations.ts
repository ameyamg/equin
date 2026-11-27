import {
  asPluginId,
  type PluginId,
} from "@plugins/framework/plugins/plugin-id/core";
import type { SiteFeedDecl } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import type { ComponentType } from "react";
import { SiteFeeds, type SiteFeedPreviewProps } from "../slots";

/** One feed the code declares, with the plugin that declared it. */
export interface SiteFeedDeclaration {
  readonly feed: SiteFeedDecl;
  /** Whose feed it is: what a deployment must ship to carry the feed. */
  readonly pluginId: PluginId;
  /** One entry drawn as the site draws it, when the site plugin offers it. */
  readonly preview: ComponentType<SiteFeedPreviewProps> | null;
}

/**
 * Every feed contributed to `SiteFeeds.Feed` on this page, with its declaring
 * plugin (the contribution's own stamp — never restated by the site).
 */
export function useSiteFeedDeclarations(): readonly SiteFeedDeclaration[] {
  return SiteFeeds.Feed.useContributions().map((c) => {
    if (c._pluginId === undefined) {
      throw new Error(
        `site-feeds: the contribution of feed "${c.feed.id}" carries no plugin id`,
      );
    }
    return {
      feed: c.feed,
      pluginId: asPluginId(String(c._pluginId)),
      preview: c.preview ?? null,
    };
  });
}
