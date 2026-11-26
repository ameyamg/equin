import { text } from "drizzle-orm/pg-core";
import { defineTriggerEvent } from "@plugins/infra/plugins/events/server";

/** What a publish or unpublish of one feed item tells its subscribers. */
export interface SiteFeedItemEventPayload {
  itemId: string;
  feedId: string;
  [key: string]: unknown;
}

/**
 * `siteFeeds.itemPublished` — also `firstPublish`: false when an edit was
 * published again. Emitted once per publish of the item, when its PRIMARY
 * destination has it (the first deployment this instance publishes to, else
 * this instance) — never once per destination.
 */
export interface SiteFeedItemPublishedPayload extends SiteFeedItemEventPayload {
  firstPublish: boolean;
}

// The hook point of whatever follows a publish (syndication: posting the item
// to other services). Emitted by the publish job once the item's primary destination has it —
// a subscriber binds a job with `Trigger({ on: siteFeedItemPublished, … })`,
// filtered by feed, rather than the job naming it.
export const {
  event: siteFeedItemPublished,
  table: _siteFeedItemPublishedTriggers,
} = defineTriggerEvent<SiteFeedItemPublishedPayload>({
  name: "siteFeeds.itemPublished",
  filters: {
    feedId: text("feed_id"),
  },
});

// Emitted once no destination serves the item any more.
export const {
  event: siteFeedItemUnpublished,
  table: _siteFeedItemUnpublishedTriggers,
} = defineTriggerEvent<SiteFeedItemEventPayload>({
  name: "siteFeeds.itemUnpublished",
  filters: {
    feedId: text("feed_id"),
  },
});
