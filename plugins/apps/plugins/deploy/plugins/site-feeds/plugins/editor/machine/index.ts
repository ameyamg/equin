import type { MachinePluginDefinition } from "@plugins/framework/plugins/server-core/core";
import {
  publishSiteFeedItem,
  unpublishSiteFeedItem,
  updateSiteFeedItem,
} from "../shared";
import { siteFeedPublishJob } from "./internal/jobs";
import {
  handlePublishItem,
  handleUnpublishItem,
  handleUpdateItem,
} from "./internal/routes";

export default {
  description:
    "Publishing site feed items to every copy of their site: the site-feeds.publish job, keyed by item and destination, brings one copy to what the item now asks — published: the files it lacks sent (for a deployed site: copied out of the attachment store, hashed, scp'd into the box's staging dir and imported there; for this instance: none, its box half is called in-process) then the entry upserted, which that copy validates against its own declaration; a draft: the entry deleted there. A refusal ends it failed in words, a transport failure is retried; a deployed site is never published to off main (a worktree's database holds production's rows). The update (autosave — a published item published again wherever it is), publish (every destination, or one) and unpublish routes that queue it; siteFeeds.itemPublished once the item's primary destination has it, siteFeeds.itemUnpublished once no destination does.",
  httpRoutes: {
    [updateSiteFeedItem.route]: handleUpdateItem,
    [publishSiteFeedItem.route]: handlePublishItem,
    [unpublishSiteFeedItem.route]: handleUnpublishItem,
  },
  register: [siteFeedPublishJob],
} satisfies MachinePluginDefinition;
