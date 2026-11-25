import {
  implement,
  rawEndpointHandler,
} from "@plugins/infra/plugins/endpoints/server";
import {
  capBodySize,
  hostOnly,
} from "@plugins/apps/plugins/deploy/plugins/analytics/plugins/host-only/server";
import {
  SITE_FEED_UPSERT_MAX_BYTES,
  siteFeedDeleteEndpoint,
  siteFeedMissingMediaEndpoint,
  siteFeedUpsertEndpoint,
} from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import { siteFeedOf } from "./registry";
import { deleteSiteFeedEntry } from "./delete";
import {
  missingIds,
  presentAttachmentIds,
  upsertSiteFeedEntry,
} from "./upsert";

// The box's host-only routes: reached only from the box itself (`hostOnly`,
// and Caddy's `/api/host-only/*` 404 in front), by the computer's SSH curl.

export const handleSiteFeedUpsert = rawEndpointHandler(
  siteFeedUpsertEndpoint,
  hostOnly(
    capBodySize(
      SITE_FEED_UPSERT_MAX_BYTES,
      implement(siteFeedUpsertEndpoint, async ({ body }) => {
        const feed = siteFeedOf(body.feedId);
        if (feed === null) return { kind: "unknown-feed", feedId: body.feedId };
        return upsertSiteFeedEntry(feed, body);
      }),
    ),
  ),
);

export const handleSiteFeedDelete = rawEndpointHandler(
  siteFeedDeleteEndpoint,
  hostOnly(
    capBodySize(
      SITE_FEED_UPSERT_MAX_BYTES,
      implement(siteFeedDeleteEndpoint, async ({ body }) => {
        const feed = siteFeedOf(body.feedId);
        if (feed === null) return { kind: "unknown-feed", feedId: body.feedId };
        return deleteSiteFeedEntry(feed, body.id);
      }),
    ),
  ),
);

export const handleSiteFeedMissingMedia = hostOnly(
  implement(siteFeedMissingMediaEndpoint, async ({ query: { q } }) => ({
    missing: missingIds(
      q.attachmentIds,
      await presentAttachmentIds(q.attachmentIds),
    ),
  })),
);
