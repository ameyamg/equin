import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@plugins/database/server";
import { defineJob } from "@plugins/infra/plugins/jobs/server";
import { siteFeedEntryIdKind } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import { siteFeedItemPublished, siteFeedItemUnpublished } from "../../server";
import { _siteFeedItems } from "../../server/internal/tables";
import {
  feedOfItem,
  type SiteFeedItemRecord,
} from "../../server/internal/items-repo";
import { publishItem, unpublishItem } from "./publish-flow";
import { boxTransport } from "./transport";

/** Publish and unpublish share one lane: one transfer to a box at a time, in order. */
const SITE_FEEDS_LANE = { with: "site-feeds.box" } as const;

const ItemInputSchema = z.object({ itemId: z.string() });

async function readItem(itemId: string): Promise<SiteFeedItemRecord | null> {
  const [row] = await db
    .select()
    .from(_siteFeedItems)
    .where(eq(_siteFeedItems.id, siteFeedEntryIdKind.key(itemId)));
  return row ?? null;
}

/** End a run for good: `failed` with the reason, unless another job took the item since. */
async function markFailed(
  itemId: string,
  from: "publishing" | "unpublishing",
  message: string,
): Promise<void> {
  await db
    .update(_siteFeedItems)
    .set({ publishState: "failed", publishError: message })
    .where(
      and(
        eq(_siteFeedItems.id, siteFeedEntryIdKind.key(itemId)),
        eq(_siteFeedItems.publishState, from),
      ),
    );
}

/**
 * Publishes one feed item to its site's box: copies the files the box lacks
 * (scp, then the box's import), then upserts the entry. A refusal (the site
 * runs an older feed, the server is not set up) ends it as `failed` with the
 * reason; a transport failure is retried.
 */
export const siteFeedPublishJob = defineJob({
  name: "site-feeds.publish",
  description:
    "Publishes a site feed item to its site: copies the media files the site does not have yet, then writes the entry the site's visitors read.",
  hold: "minutes",
  inProcess:
    "every step is idempotent (a file the box holds is not sent again, the entry is an upsert), so a run cut by a restart is re-run from the start",
  input: ItemInputSchema,
  event: z.never(),
  dedup: { key: ({ itemId }) => itemId },
  serial: SITE_FEEDS_LANE,
  maxAttempts: 4,
  async run({ input: { itemId } }) {
    const item = await readItem(itemId);
    // Deleted, or an unpublish took it since: nothing to publish.
    if (item === null || item.publishState !== "publishing") return;
    const feed = feedOfItem(item);
    if (feed === null) {
      await markFailed(
        itemId,
        "publishing",
        `No plugin of this app declares the feed "${item.feedId}" any more.`,
      );
      return;
    }
    const publishedAt = item.publishedAt ?? new Date();
    const outcome = await publishItem(boxTransport(item.deploymentId), {
      id: item.id,
      feed,
      values: item.values,
      publishedAt,
    });
    if (outcome.kind === "refused") {
      await markFailed(itemId, "publishing", outcome.message);
      return;
    }
    // Published what it read — `idle` only while the item is still what was
    // read: an edit since queued its own run (keyed), which must still find
    // `publishing` and publish the newer values.
    const [marked] = await db
      .update(_siteFeedItems)
      .set({
        state: "published",
        publishedAt,
        publishState: "idle",
        publishError: null,
      })
      .where(
        and(
          eq(_siteFeedItems.id, item.id),
          eq(_siteFeedItems.publishState, "publishing"),
          // The column keeps microseconds; the Date read back, milliseconds.
          sql`date_trunc('milliseconds', ${_siteFeedItems.updatedAt}) = ${item.updatedAt.toISOString()}::timestamptz`,
        ),
      )
      .returning({ id: _siteFeedItems.id });
    if (marked === undefined) return;
    // The hook point of what follows a publish (syndication subscribes).
    await siteFeedItemPublished.emit({
      itemId: item.id,
      deploymentId: item.deploymentId,
      feedId: item.feedId,
      firstPublish: item.state === "draft",
    });
  },
  onDead: async ({ input: { itemId }, death }) => {
    await markFailed(itemId, "publishing", death.error);
  },
});

/** Deletes a feed item's entry on its site's box; the item stays here as a draft. */
export const siteFeedUnpublishJob = defineJob({
  name: "site-feeds.unpublish",
  description:
    "Unpublishes a site feed item: deletes its entry on the site, so visitors no longer see it; the item stays here as a draft.",
  // seconds: one curl over SSH, bounded by its own deadline.
  hold: "seconds",
  input: ItemInputSchema,
  event: z.never(),
  dedup: { key: ({ itemId }) => itemId },
  serial: SITE_FEEDS_LANE,
  maxAttempts: 4,
  async run({ input: { itemId } }) {
    const item = await readItem(itemId);
    if (item === null || item.publishState !== "unpublishing") return;
    const outcome = await unpublishItem(boxTransport(item.deploymentId), {
      id: item.id,
      feedId: item.feedId,
    });
    if (outcome.kind === "refused") {
      await markFailed(itemId, "unpublishing", outcome.message);
      return;
    }
    const [marked] = await db
      .update(_siteFeedItems)
      .set({
        state: "draft",
        publishedAt: null,
        publishState: "idle",
        publishError: null,
      })
      .where(
        and(
          eq(_siteFeedItems.id, item.id),
          eq(_siteFeedItems.publishState, "unpublishing"),
        ),
      )
      .returning({ id: _siteFeedItems.id });
    if (marked === undefined) return;
    await siteFeedItemUnpublished.emit({
      itemId: item.id,
      deploymentId: item.deploymentId,
      feedId: item.feedId,
    });
  },
  onDead: async ({ input: { itemId }, death }) => {
    await markFailed(itemId, "unpublishing", death.error);
  },
});
