import { and, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db } from "@plugins/database/server";
import { createKeyedMutex } from "@plugins/packages/plugins/keyed-mutex/core";
import { HttpError } from "@plugins/infra/plugins/endpoints/server";
import { _deployDeployments } from "@plugins/apps/plugins/deploy/plugins/deployments/server";
import { deploymentIdKind } from "@plugins/apps/plugins/deploy/plugins/deployments/core";
import {
  siteFeedEntryIdKind,
  type SiteFeedDecl,
} from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import {
  judgeSiteFeedValues,
  siteFeedOf,
} from "@plugins/apps/plugins/deploy/plugins/site-feeds/plugins/box/server";
import { siteFeedSearchText, type SiteFeedPublishState } from "../../core";
import type { UpdateSiteFeedItemAnswer } from "../../shared";
import { siteFeedItemAttachments } from "./schema-attachments";
import { _siteFeedItems } from "./tables";

/** A stored item row. */
export type SiteFeedItemRecord = typeof _siteFeedItems.$inferSelect;

/** The item `id`, or a 404. */
export async function requireItem(
  id: string,
  exec: NodePgDatabase = db,
): Promise<SiteFeedItemRecord> {
  const [row] = await exec
    .select()
    .from(_siteFeedItems)
    .where(eq(_siteFeedItems.id, siteFeedEntryIdKind.key(id)));
  if (!row) throw new HttpError(404, `Unknown site feed item: ${id}`);
  return row;
}

/** A new draft of `feedId` on `deploymentId`, its values the declaration's defaults. */
export async function createItem(
  deploymentId: string,
  feedId: string,
): Promise<
  { kind: "created"; id: string } | { kind: "unknown-feed"; feedId: string }
> {
  const feed = siteFeedOf(feedId);
  if (feed === null) return { kind: "unknown-feed", feedId };
  const [deployment] = await db
    .select({ id: _deployDeployments.id })
    .from(_deployDeployments)
    .where(eq(_deployDeployments.id, deploymentIdKind.key(deploymentId)));
  if (!deployment)
    throw new HttpError(404, `Unknown deployment: ${deploymentId}`);
  const id = siteFeedEntryIdKind.mint();
  const values = feed.valuesSchema.parse({}) as Record<string, unknown>;
  await db.insert(_siteFeedItems).values({
    id,
    deploymentId: deployment.id,
    feedId,
    values,
    searchText: siteFeedSearchText(feed.fields, values),
  });
  return { kind: "created", id };
}

/** One save at a time per item: each merges onto the one before it. */
const saves = createKeyedMutex("site-feeds.item-save");

/**
 * Merge `set` (the fields one edit changed) onto an item's stored values,
 * validate the result against its feed's declaration (the same judge the box
 * applies, so what saves here publishes there unless the deployed site is
 * older), and set its media links to exactly what it holds. Saves of one item
 * run one after another, so concurrent edits of different fields all land.
 * Answers the saved row, so a caller can publish a published item again.
 */
export function saveItemValues(
  id: string,
  set: Record<string, unknown>,
): Promise<{ answer: UpdateSiteFeedItemAnswer; item: SiteFeedItemRecord }> {
  return saves.run(id, () => mergeItemValues(id, set));
}

async function mergeItemValues(
  id: string,
  set: Record<string, unknown>,
): Promise<{ answer: UpdateSiteFeedItemAnswer; item: SiteFeedItemRecord }> {
  const item = await requireItem(id);
  const values = { ...item.values, ...set };
  const feed = siteFeedOf(item.feedId);
  if (feed === null) {
    return { answer: { kind: "unknown-feed", feedId: item.feedId }, item };
  }
  const judged = judgeSiteFeedValues(feed, values);
  if (judged.kind !== "valid") return { answer: judged, item };
  const [saved] = await db
    .update(_siteFeedItems)
    .set({
      values: judged.values,
      searchText: siteFeedSearchText(feed.fields, judged.values),
    })
    .where(eq(_siteFeedItems.id, item.id))
    .returning();
  if (!saved) throw new HttpError(404, `Unknown site feed item: ${id}`);
  await siteFeedItemAttachments.set(item.id, judged.attachmentIds);
  return { answer: { kind: "saved" }, item: saved };
}

/** Delete a draft; a published or in-flight item is refused (unpublish first). */
export async function deleteItem(
  id: string,
): Promise<{ kind: "deleted" } | { kind: "published" } | { kind: "busy" }> {
  const item = await requireItem(id);
  if (item.state === "published") return { kind: "published" };
  const deleted = await db
    .delete(_siteFeedItems)
    .where(
      and(
        eq(_siteFeedItems.id, item.id),
        eq(_siteFeedItems.state, "draft"),
        inArray(_siteFeedItems.publishState, ["idle", "failed"]),
      ),
    )
    .returning({ id: _siteFeedItems.id });
  return deleted.length > 0 ? { kind: "deleted" } : { kind: "busy" };
}

/**
 * Move an item's publish state to `to` — only from a state that allows it,
 * so a publish never overtakes an unpublish in flight (or the reverse).
 * Answers whether it moved.
 */
export async function claimPublishState(
  id: string,
  to: Extract<SiteFeedPublishState, "publishing" | "unpublishing">,
): Promise<boolean> {
  const from: SiteFeedPublishState[] = ["idle", "failed", to];
  const moved = await db
    .update(_siteFeedItems)
    .set({ publishState: to, publishError: null })
    .where(
      and(
        eq(_siteFeedItems.id, siteFeedEntryIdKind.key(id)),
        inArray(_siteFeedItems.publishState, from),
      ),
    )
    .returning({ id: _siteFeedItems.id });
  return moved.length > 0;
}

/** The feed an item belongs to, as this app declares it — or null (its site plugin is gone). */
export function feedOfItem(item: SiteFeedItemRecord): SiteFeedDecl | null {
  return siteFeedOf(item.feedId);
}
