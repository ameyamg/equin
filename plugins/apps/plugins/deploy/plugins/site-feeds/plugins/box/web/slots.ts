import { defineSlot } from "@plugins/framework/plugins/web-sdk/core";
import type { SiteFeedDecl } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";

/** What a site plugin contributes: one feed it declares. */
export interface SiteFeedWebContribution {
  readonly feed: SiteFeedDecl;
}

/**
 * The feeds the code declares, in the browser — the web twin of the box's
 * server registry. A site plugin's `web/` contributes `SiteFeeds.Feed({ feed })`
 * and its `server/` the same declaration; the local editor lists them
 * (`useSiteFeedDeclarations`), each with the plugin that declared it. Data,
 * never drawn.
 */
export const SiteFeeds = {
  Feed: defineSlot<SiteFeedWebContribution>({
    docLabel: (c) => c.feed.id,
  }),
};
