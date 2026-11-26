import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@plugins/database/server";
import { defineJob } from "@plugins/infra/plugins/jobs/server";
import { isMain } from "@plugins/infra/plugins/runtime-identity/core";
import { siteFeedEntryIdKind } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import {
  type SiteFeedDestination,
  type SiteFeedPublicationState,
} from "../../core";
import {
  primarySiteFeedDestination,
  siteFeedItemPublished,
  siteFeedItemUnpublished,
} from "../../server";
import {
  _siteFeedItems,
  _siteFeedPublications,
} from "../../server/internal/tables";
import {
  feedOfItem,
  type SiteFeedItemRecord,
} from "../../server/internal/items-repo";
import { decidePublication, routeDestination } from "./fan-out";
import {
  publishItem,
  unpublishItem,
  type PublishTransport,
} from "./publish-flow";
import { boxTransport } from "./transport";
import { localTransport } from "./local-transport";

/** One transfer at a time, in order: a box's SSH sessions are few. */
const SITE_FEEDS_LANE = { with: "site-feeds.box" } as const;

const PublicationInputSchema = z.object({
  itemId: z.string(),
  destination: z.string(),
});

async function readItem(itemId: string): Promise<SiteFeedItemRecord | null> {
  const [row] = await db
    .select()
    .from(_siteFeedItems)
    .where(eq(_siteFeedItems.id, siteFeedEntryIdKind.key(itemId)));
  return row ?? null;
}

function rowWhere(itemId: string, destination: string) {
  return and(
    eq(_siteFeedPublications.itemId, siteFeedEntryIdKind.key(itemId)),
    eq(_siteFeedPublications.destination, destination),
  );
}

async function readRow(itemId: string, destination: string) {
  const [row] = await db
    .select()
    .from(_siteFeedPublications)
    .where(rowWhere(itemId, destination));
  return row ?? null;
}

async function markFailed(
  itemId: string,
  destination: string,
  error: string,
): Promise<void> {
  await db
    .update(_siteFeedPublications)
    .set({ state: "failed", error })
    .where(rowWhere(itemId, destination));
}

/** The transport to one destination — or why this instance may not use it (`routeDestination`). */
function transportFor(
  destination: SiteFeedDestination,
):
  | { kind: "transport"; transport: PublishTransport }
  | { kind: "refused"; message: string } {
  const route = routeDestination(destination, isMain());
  switch (route.kind) {
    case "local":
      return { kind: "transport", transport: localTransport() };
    case "deployment":
      return { kind: "transport", transport: boxTransport(route.deploymentId) };
    case "refused":
      return route;
  }
}

/** Is `destination` the one whose success stands for the item's (see `primaryDestination`)? */
async function isPrimary(
  feedId: string,
  destination: string,
): Promise<boolean> {
  const primary = await primarySiteFeedDestination(feedId);
  return primary !== null && primary.destination === destination;
}

/**
 * Brings one destination to what the user wants of the item NOW
 * (`decidePublication`): published → its files the destination lacks are
 * sent and the entry upserted (validated there against THAT copy's
 * declaration); a draft → the entry deleted there, and the row with it. A
 * refusal ends the run `failed` with the reason; a transport failure is
 * retried. Once the item's primary destination has it, `siteFeeds.itemPublished`;
 * once no destination holds it, `siteFeeds.itemUnpublished`.
 */
export const siteFeedPublishJob = defineJob({
  name: "site-feeds.publish",
  description:
    "Publishes a site feed item to one copy of its site (this instance, or a deployed site), or unpublishes it there — whichever the item now asks — copying the media files that copy lacks first.",
  hold: "minutes",
  inProcess:
    "every step is idempotent (a file the destination holds is not sent again, the entry is an upsert or a delete), and the run reads the item's state fresh, so a run cut by a restart is re-run from the start",
  input: PublicationInputSchema,
  event: z.never(),
  dedup: {
    key: ({ itemId, destination }) => `${itemId}/${destination}`,
  },
  serial: SITE_FEEDS_LANE,
  maxAttempts: 4,
  async run({ input: { itemId, destination } }) {
    const item = await readItem(itemId);
    // Deleted: its rows went with it.
    if (item === null) return;
    const row = await readRow(itemId, destination);
    const action = decidePublication({
      wanted: item.state === "published",
      held: row !== null,
    });
    if (action === "nothing" || row === null) return;
    const dest = destination as SiteFeedDestination;
    const route = transportFor(dest);
    if (route.kind === "refused") {
      await markFailed(itemId, destination, route.message);
      return;
    }

    if (action === "unpublish") {
      const outcome = await unpublishItem(route.transport, {
        id: item.id,
        feedId: item.feedId,
      });
      if (outcome.kind === "refused") {
        await markFailed(itemId, destination, outcome.message);
        return;
      }
      // Gone there — unless the item was published again since (its own
      // queued run upserts it back and keeps the row).
      await db
        .delete(_siteFeedPublications)
        .where(
          and(
            rowWhere(itemId, destination),
            sql`exists (select 1 from ${_siteFeedItems} where ${_siteFeedItems.id} = ${item.id} and ${_siteFeedItems.state} = 'draft')`,
          ),
        );
      const left = await db
        .select({ destination: _siteFeedPublications.destination })
        .from(_siteFeedPublications)
        .where(eq(_siteFeedPublications.itemId, item.id))
        .limit(1);
      if (left.length === 0) {
        await siteFeedItemUnpublished.emit({
          itemId: item.id,
          feedId: item.feedId,
        });
      }
      return;
    }

    const feed = feedOfItem(item);
    if (feed === null) {
      await markFailed(
        itemId,
        destination,
        `No plugin of this app declares the feed "${item.feedId}" any more.`,
      );
      return;
    }
    const outcome = await publishItem(route.transport, {
      id: item.id,
      feed,
      values: item.values,
      publishedAt: item.publishedAt ?? new Date(),
    });
    if (outcome.kind === "refused") {
      await markFailed(itemId, destination, outcome.message);
      return;
    }
    // Published what it read — only while the item is still what was read:
    // an edit (or an unpublish) since queued its own run, which must still
    // find the row in flight.
    const [marked] = await db
      .update(_siteFeedPublications)
      .set({ state: "published", error: null, publishedAt: new Date() })
      .where(
        and(
          rowWhere(itemId, destination),
          sql`exists (select 1 from ${_siteFeedItems} where ${_siteFeedItems.id} = ${item.id} and ${_siteFeedItems.state} = 'published' and date_trunc('milliseconds', ${_siteFeedItems.updatedAt}) = ${item.updatedAt.toISOString()}::timestamptz)`,
        ),
      )
      .returning({ destination: _siteFeedPublications.destination });
    if (marked === undefined) return;
    if (await isPrimary(item.feedId, destination)) {
      await siteFeedItemPublished.emit({
        itemId: item.id,
        feedId: item.feedId,
        firstPublish: row.publishedAt === null,
      });
    }
  },
  onDead: async ({ input: { itemId, destination }, death }) => {
    await markFailed(itemId, destination, death.error);
  },
});

/** Mark (item, destination) in flight — the row created if new — and queue its run. */
export async function queuePublication(
  itemId: string,
  destination: SiteFeedDestination,
  state: Extract<SiteFeedPublicationState, "publishing" | "unpublishing">,
): Promise<void> {
  await db
    .insert(_siteFeedPublications)
    .values({
      itemId: siteFeedEntryIdKind.key(itemId),
      destination,
      state,
    })
    .onConflictDoUpdate({
      target: [_siteFeedPublications.itemId, _siteFeedPublications.destination],
      set: { state, error: null },
    });
  await siteFeedPublishJob.enqueue({ itemId, destination });
}

/** Re-queue every destination an item has a row on, as `state`. Answers them. */
export async function requeueHeld(
  itemId: string,
  state: Extract<SiteFeedPublicationState, "publishing" | "unpublishing">,
): Promise<SiteFeedDestination[]> {
  const rows = await db
    .select({ destination: _siteFeedPublications.destination })
    .from(_siteFeedPublications)
    .where(eq(_siteFeedPublications.itemId, siteFeedEntryIdKind.key(itemId)));
  const destinations = rows.map((r) => r.destination as SiteFeedDestination);
  for (const d of destinations) await queuePublication(itemId, d, state);
  return destinations;
}
