import type { MachinePluginDefinition } from "@plugins/framework/plugins/server-core/core";
import {
  publishSiteFeedItem,
  unpublishSiteFeedItem,
  updateSiteFeedItem,
} from "../shared";
import { siteFeedPublishJob, siteFeedUnpublishJob } from "./internal/jobs";
import {
  handlePublishItem,
  handleUnpublishItem,
  handleUpdateItem,
} from "./internal/routes";

export default {
  description:
    "Publishing site feed items: the site-feeds.publish job (asks the site's box which of the item's files it lacks, copies each out of the attachment store — hashed — into the box's staging dir over scp and has the box import it, then upserts the entry, which the box validates against its own declaration; a refusal ends it failed with the reason in words, a transport failure is retried) and site-feeds.unpublish (deletes the entry on the box), one at a time per backend; the update (autosave, a published item published again), publish and unpublish routes that queue them; both jobs emit siteFeeds.itemPublished / itemUnpublished when done.",
  httpRoutes: {
    [updateSiteFeedItem.route]: handleUpdateItem,
    [publishSiteFeedItem.route]: handlePublishItem,
    [unpublishSiteFeedItem.route]: handleUnpublishItem,
  },
  register: [siteFeedPublishJob, siteFeedUnpublishJob],
} satisfies MachinePluginDefinition;
