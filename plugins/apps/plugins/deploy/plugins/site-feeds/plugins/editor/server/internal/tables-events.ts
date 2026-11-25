import { text } from "drizzle-orm/pg-core";
import { defineTriggerEvent } from "@plugins/infra/plugins/events/server";

/** What a publish or unpublish of one feed item tells its subscribers. */
export interface SiteFeedItemEventPayload {
  itemId: string;
  deploymentId: string;
  feedId: string;
  [key: string]: unknown;
}

/** `siteFeeds.itemPublished` — also `firstPublish`: false when an edit was published again. */
export interface SiteFeedItemPublishedPayload extends SiteFeedItemEventPayload {
  firstPublish: boolean;
}

// The hook point of whatever follows a publish (syndication: posting the item
// to other services). Emitted by the publish job once the box has the entry —
// a subscriber binds a job with `Trigger({ on: siteFeedItemPublished, … })`,
// filtered by feed or site, rather than the job naming it.
export const {
  event: siteFeedItemPublished,
  table: _siteFeedItemPublishedTriggers,
} = defineTriggerEvent<SiteFeedItemPublishedPayload>({
  name: "siteFeeds.itemPublished",
  filters: {
    feedId: text("feed_id"),
    deploymentId: text("deployment_id"),
  },
});

// Emitted by the unpublish job once the box no longer serves the entry.
export const {
  event: siteFeedItemUnpublished,
  table: _siteFeedItemUnpublishedTriggers,
} = defineTriggerEvent<SiteFeedItemEventPayload>({
  name: "siteFeeds.itemUnpublished",
  filters: {
    feedId: text("feed_id"),
    deploymentId: text("deployment_id"),
  },
});
