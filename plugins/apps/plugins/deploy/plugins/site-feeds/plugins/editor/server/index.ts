import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { createSiteFeedItem, deleteSiteFeedItem } from "../shared";
import { handleCreateItem, handleDeleteItem } from "./internal/handlers";
import { siteFeedItemsContributions } from "./internal/served";
import {
  siteFeedItemPublished,
  siteFeedItemUnpublished,
} from "./internal/tables-events";

export {
  siteFeedItemPublished,
  siteFeedItemUnpublished,
  _siteFeedItemPublishedTriggers,
  _siteFeedItemUnpublishedTriggers,
} from "./internal/tables-events";
export { _siteFeedItems } from "./internal/tables";
export { feedOfItem } from "./internal/items-repo";
export {
  primarySiteFeedDestination,
  siteFeedDestinations,
} from "./internal/destinations";
export type { ResolvedDestination } from "./internal/destination-rules";
export type { SiteFeedItemRecord } from "./internal/items-repo";
export type {
  SiteFeedItemEventPayload,
  SiteFeedItemPublishedPayload,
} from "./internal/tables-events";

export default {
  description:
    "Site feed items on this computer — the source of truth for what a site's feeds publish: the site_feed_items table (a draft or published item of one feed — never of one deployment — its values validated against the feed's declaration on every write) and its attachment links (set from the values' media on every save, so drafts keep their files); site_feed_publications (one item on one destination — this instance, or a deployment shipping the feed — publishing, published, unpublishing or failed with why) served live per item; the live site-feeds.items window per feed; site-feeds.publish-scope (whether this instance publishes to deployed sites: main only, never a worktree whose database is a fork holding production's rows); the destinations a feed's items go to (siteFeedDestinations: every deployment whose composition closure includes the feed's declaring plugin, then this instance); the create and delete routes (a draft only); and the siteFeeds.itemPublished / siteFeeds.itemUnpublished events — once per item, when its primary destination has it (or no destination holds it any more) — that syndication subscribes to.",
  httpRoutes: {
    [createSiteFeedItem.route]: handleCreateItem,
    [deleteSiteFeedItem.route]: handleDeleteItem,
  },
  register: [siteFeedItemPublished, siteFeedItemUnpublished],
  contributions: [...siteFeedItemsContributions],
} satisfies ServerPluginDefinition;
