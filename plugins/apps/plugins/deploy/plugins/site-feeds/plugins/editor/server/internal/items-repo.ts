import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db } from "@plugins/database/server";
import { createKeyedMutex } from "@plugins/packages/plugins/keyed-mutex/core";
import { HttpError } from "@plugins/infra/plugins/endpoints/server";
import {
  siteFeedEntryIdKind,
  type SiteFeedDecl,
} from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import {
  judgeSiteFeedValues,
  siteFeedOf,
} from "@plugins/apps/plugins/deploy/plugins/site-feeds/plugins/box/server";
import { siteFeedSearchText } from "../../core";
import type { UpdateSiteFeedItemAnswer } from "../../shared";
import { siteFeedItemAttachments } from "./schema-attachments";
import { _siteFeedItems, _siteFeedPublications } from "./tables";

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

/** A new draft of `feedId`, its values the declaration's defaults. */
export async function createItem(
  feedId: string,
): Promise<
  { kind: "created"; id: string } | { kind: "unknown-feed"; feedId: string }
> {
  const feed = siteFeedOf(feedId);
  if (feed === null) return { kind: "unknown-feed", feedId };
  const id = siteFeedEntryIdKind.mint();
  const values = feed.valuesSchema.parse({}) as Record<string, unknown>;
  await db.insert(_siteFeedItems).values({
    id,
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

/**
 * Delete a draft. A published item is refused (unpublish first), and so is a
 * draft some destination still holds or is on its way to (`busy`): its
 * unpublish has not finished everywhere yet.
 */
export async function deleteItem(
  id: string,
): Promise<{ kind: "deleted" } | { kind: "published" } | { kind: "busy" }> {
  const item = await requireItem(id);
  if (item.state === "published") return { kind: "published" };
  return db.transaction(async (tx) => {
    const held = await tx
      .select({ destination: _siteFeedPublications.destination })
      .from(_siteFeedPublications)
      .where(eq(_siteFeedPublications.itemId, item.id))
      .limit(1);
    if (held.length > 0) return { kind: "busy" as const };
    const deleted = await tx
      .delete(_siteFeedItems)
      .where(
        and(eq(_siteFeedItems.id, item.id), eq(_siteFeedItems.state, "draft")),
      )
      .returning({ id: _siteFeedItems.id });
    return deleted.length > 0
      ? { kind: "deleted" as const }
      : { kind: "busy" as const };
  });
}

/** The feed an item belongs to, as this app declares it — or null (its site plugin is gone). */
export function feedOfItem(item: SiteFeedItemRecord): SiteFeedDecl | null {
  return siteFeedOf(item.feedId);
}
