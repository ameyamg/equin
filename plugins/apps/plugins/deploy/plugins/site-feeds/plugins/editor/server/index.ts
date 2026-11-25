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
export type { SiteFeedItemRecord } from "./internal/items-repo";
export type {
  SiteFeedItemEventPayload,
  SiteFeedItemPublishedPayload,
} from "./internal/tables-events";

export default {
  description:
    "Site feed items on this computer — the source of truth for what a site's feeds publish: the site_feed_items table (a draft or published item of one deployment's feed, its values validated against the feed's declaration on every write, its publish state and last error) and its attachment links (set from the values' media on every save, so drafts keep their files); the live site-feeds.items window, scoped per site and feed; the create and delete routes (a draft only); and the siteFeeds.itemPublished / siteFeeds.itemUnpublished events the publish jobs emit once the box has (or no longer has) the entry — what follows a publish (syndication) subscribes to them.",
  httpRoutes: {
    [createSiteFeedItem.route]: handleCreateItem,
    [deleteSiteFeedItem.route]: handleDeleteItem,
  },
  register: [siteFeedItemPublished, siteFeedItemUnpublished],
  contributions: [...siteFeedItemsContributions],
} satisfies ServerPluginDefinition;
