import { z } from "zod";
import { liveValue } from "@plugins/network/plugins/live/core";
import { blob, defineEndpoint } from "@plugins/infra/plugins/endpoints/core";
import { cappedList } from "@plugins/packages/plugins/list-bound/core";
import {
  SITE_FEED_PUBLIC_LIMIT_MAX,
  SiteFeedEntrySchema,
} from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";

/** One feed's published entries, newest first, at most its `publicLimit`. */
export const SiteFeedEntriesSchema = z.object({
  entries: cappedList(SiteFeedEntrySchema, { max: SITE_FEED_PUBLIC_LIMIT_MAX }),
});
export type SiteFeedEntries = z.infer<typeof SiteFeedEntriesSchema>;

/**
 * The public read of one feed: what the site's section renders. Visitor
 * readable for a feed this site declares (the serve's `visitorTuple`), bounded
 * by the feed's own `publicLimit` — a value, never a collection (a
 * collection's tuples are queries, which a visitor must not choose).
 */
export const siteFeedEntries = liveValue("site-feeds.entries", {
  schema: SiteFeedEntriesSchema,
  params: ["feedId"],
  // In the first frame: a site's section is drawn from it, and a static
  // render (the crawl snapshot) must find it there rather than wait.
  preload: "boot",
  refusals: ["unknown-feed"],
  access: {
    visitor:
      "a deployed site's pages render the entries of the feeds the site declares — content published to be read by anyone",
  },
});

/**
 * One file of a published entry: served only while the entry links that
 * attachment, with byte ranges (a video seeks) and as immutable (an
 * attachment's bytes never change).
 */
export const siteFeedMediaFile = defineEndpoint({
  route: "GET /api/site-feeds/media/:entryId/:attachmentId",
  response: blob(),
  access: {
    visitor:
      "the images and videos of a published feed entry, which the site's pages show to anyone",
  },
});
