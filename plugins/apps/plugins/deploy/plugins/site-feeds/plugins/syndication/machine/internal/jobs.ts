import { z } from "zod";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@plugins/database/server";
import { defineJob } from "@plugins/infra/plugins/jobs/server";
import { siteFeedEntryIdKind } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import {
  _siteFeedItems,
  feedOfItem,
  primarySiteFeedDestination,
  type SiteFeedItemRecord,
} from "@plugins/apps/plugins/deploy/plugins/site-feeds/plugins/editor/server";
import {
  syndicatedMediaRefs,
  syndicatedText,
  type SyndicatedMedia,
  type SyndicatedPost,
} from "../../core";
import type { SiteFeedDecl } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import { syndicationTargetOf } from "../../server";
import { _siteFeedSyndications } from "../../server/internal/tables";
import { syndicateOnce, type SyndicationWorld } from "./flow";
import { enabledTargets, loadTargetSettings } from "./settings";
import { makeWorkDir, stageMedia } from "./stage";

const ItemTargetSchema = z.object({ itemId: z.string(), targetId: z.string() });

export async function readItem(
  itemId: string,
): Promise<SiteFeedItemRecord | null> {
  const [row] = await db
    .select()
    .from(_siteFeedItems)
    .where(eq(_siteFeedItems.id, siteFeedEntryIdKind.key(itemId)));
  return row ?? null;
}

function rowWhere(itemId: string, targetId: string) {
  return and(
    eq(_siteFeedSyndications.itemId, siteFeedEntryIdKind.key(itemId)),
    eq(_siteFeedSyndications.targetId, targetId),
  );
}

/** Why an item cannot be posted anywhere, in words — null when it can. */
export function unpostableReason(item: SiteFeedItemRecord): string | null {
  const feed = feedOfItem(item);
  if (feed === null) {
    return `No plugin of this app declares the feed "${item.feedId}" any more.`;
  }
  if (feed.syndicate === undefined) {
    return `The feed "${feed.label}" declares nothing to post elsewhere.`;
  }
  return null;
}

/**
 * An item as a post: its feed's `syndicate` text, its media copied into
 * `workDir`, and the feed's page on its primary copy of the site (the first
 * deployment this instance publishes to, else this instance).
 */
export async function buildPost(
  item: SiteFeedItemRecord,
  feed: SiteFeedDecl,
  workDir: string,
): Promise<SyndicatedPost> {
  const text = syndicatedText(feed, item.values) ?? {
    title: null,
    paragraphs: [],
  };
  const primary = await primarySiteFeedDestination(feed.id);
  const media: SyndicatedMedia[] = [];
  const refs = syndicatedMediaRefs(feed, item.values);
  for (const [i, ref] of refs.entries()) {
    media.push(await stageMedia(ref, i, workDir));
  }
  return { ...text, media, url: primary?.url ?? null };
}

/** The real world one run reads: the item, its row, the target's settings, the files. */
function worldFor(
  itemId: string,
  targetId: string,
  workDir: string,
): SyndicationWorld {
  let item: SiteFeedItemRecord | null | undefined;
  const loadItem = async () => (item ??= await readItem(itemId));
  const target = syndicationTargetOf(targetId);
  return {
    target,
    item: async () => {
      const it = await loadItem();
      if (it === null) return null;
      return {
        published: it.state === "published",
        unpostable: unpostableReason(it),
      };
    },
    remoteId: async () => {
      const [row] = await db
        .select({ remoteId: _siteFeedSyndications.remoteId })
        .from(_siteFeedSyndications)
        .where(rowWhere(itemId, targetId));
      return row?.remoteId ?? null;
    },
    settings: async () => {
      const it = await loadItem();
      if (it === null || target === null) return null;
      return loadTargetSettings(it.feedId, target);
    },
    stage: async () => {
      const it = await loadItem();
      const feed = it === null ? null : feedOfItem(it);
      if (it === null || feed === null) {
        throw new Error(`site-feeds: item ${itemId} vanished mid-run`);
      }
      return {
        post: await buildPost(it, feed, workDir),
        // The run's work dir goes whole when the run ends.
        dispose: async () => undefined,
      };
    },
  };
}

async function markFailed(
  itemId: string,
  targetId: string,
  error: string,
): Promise<void> {
  await db
    .update(_siteFeedSyndications)
    .set({ state: "failed", error })
    .where(rowWhere(itemId, targetId));
}

/** A retryable failure: thrown so the job retries it, its words kept on the row meanwhile. */
class SyndicationRetryError extends Error {
  override name = "SyndicationRetryError";
}

/**
 * Sends one feed item to one target — posts it, edits the post, or removes
 * it, whichever where the item stands asks (`syndicateOnce`). One at a time
 * on this backend: a video may be re-encoded to fit the target.
 */
export const syndicateJob = defineJob({
  name: "site-feeds.syndicate",
  description:
    "Posts a site feed item to another service (or edits or deletes that post), re-encoding a video when the service's upload limit asks.",
  hold: "minutes",
  inProcess:
    "re-encoding a video to fit a service's upload limit takes minutes, and the run reads the item's state fresh, so a run cut by a restart is re-run from the start",
  input: ItemTargetSchema,
  event: z.never(),
  dedup: { key: ({ itemId, targetId }) => `${itemId}/${targetId}` },
  serial: { with: "site-feeds.syndication" },
  maxAttempts: 5,
  async run({ input: { itemId, targetId }, ctx }) {
    const work = await makeWorkDir();
    try {
      const outcome = await syndicateOnce(
        worldFor(itemId, targetId, work.path),
        targetId,
        { signal: ctx.signal, workDir: work.path },
      );
      switch (outcome.kind) {
        case "nothing":
          return;
        case "posted":
          await db
            .update(_siteFeedSyndications)
            .set({ state: "posted", remoteId: outcome.remoteId, error: null })
            .where(rowWhere(itemId, targetId));
          return;
        case "gone":
          await db
            .delete(_siteFeedSyndications)
            .where(rowWhere(itemId, targetId));
          return;
        case "failed":
          await markFailed(itemId, targetId, outcome.error);
          return;
        case "retry":
          await db
            .update(_siteFeedSyndications)
            .set({ error: outcome.error })
            .where(rowWhere(itemId, targetId));
          throw new SyndicationRetryError(outcome.error);
      }
    } finally {
      await work.dispose();
    }
  },
  onDead: async ({ input: { itemId, targetId }, death }) => {
    await markFailed(itemId, targetId, death.error);
  },
});

/** Mark (item, target) pending — the row created if new — and queue its run. */
export async function queueSyndication(
  itemId: string,
  targetId: string,
): Promise<void> {
  await db
    .insert(_siteFeedSyndications)
    .values({
      itemId: siteFeedEntryIdKind.key(itemId),
      targetId,
      state: "pending",
    })
    .onConflictDoUpdate({
      target: [_siteFeedSyndications.itemId, _siteFeedSyndications.targetId],
      set: { state: "pending", error: null },
    });
  await syndicateJob.enqueue({ itemId, targetId });
}

/**
 * Brings one item's posts elsewhere to where the item stands, after each
 * publish and unpublish: a published item goes to every target switched on
 * for its feed (posted, or its post edited); an unpublished one is removed
 * from every target that holds it, and forgotten where it never got.
 */
export const syndicateItemJob = defineJob({
  name: "site-feeds.syndicate-item",
  description:
    "After a site feed item is published or unpublished, queues posting it to (or removing it from) each service its feed is posted to.",
  hold: "seconds",
  input: z.object({ itemId: z.string() }),
  event: z.never(),
  dedup: { key: ({ itemId }) => itemId },
  maxAttempts: 4,
  async run({ input: { itemId } }) {
    const item = await readItem(itemId);
    if (item === null) return;
    if (item.state === "published") {
      if (unpostableReason(item) !== null) return;
      for (const target of await enabledTargets(item.feedId)) {
        await queueSyndication(item.id, target.target.id);
      }
      return;
    }
    // Unpublished: what never reached a target is forgotten…
    await db
      .delete(_siteFeedSyndications)
      .where(
        and(
          eq(_siteFeedSyndications.itemId, item.id),
          isNull(_siteFeedSyndications.remoteId),
        ),
      );
    // …and what did is removed there.
    const held = await db
      .select({ targetId: _siteFeedSyndications.targetId })
      .from(_siteFeedSyndications)
      .where(
        and(
          eq(_siteFeedSyndications.itemId, item.id),
          isNotNull(_siteFeedSyndications.remoteId),
        ),
      );
    for (const { targetId } of held) await queueSyndication(item.id, targetId);
  },
});

/** Retry one (item, target) now; nothing to do when the item is not published and nothing is there. */
export async function retryOne(
  itemId: string,
  targetId: string,
): Promise<{ kind: "queued" } | { kind: "nothing-to-do" }> {
  const item = await readItem(itemId);
  if (item === null) return { kind: "nothing-to-do" };
  if (item.state !== "published") {
    const held = await db
      .select({ targetId: _siteFeedSyndications.targetId })
      .from(_siteFeedSyndications)
      .where(
        and(
          rowWhere(itemId, targetId),
          isNotNull(_siteFeedSyndications.remoteId),
        ),
      );
    if (held.length === 0) return { kind: "nothing-to-do" };
  }
  await queueSyndication(item.id, targetId);
  return { kind: "queued" };
}
