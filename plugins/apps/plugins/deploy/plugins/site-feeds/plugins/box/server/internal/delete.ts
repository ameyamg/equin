import { and, eq } from "drizzle-orm";
import { db } from "@plugins/database/server";
import type {
  SiteFeedDecl,
  SiteFeedDeleteAnswer,
  SiteFeedEntryId,
} from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import { siteFeedEntries } from "./tables";

/**
 * Unpublish one entry. Its media links go with it (the link table cascades),
 * so the public media route stops serving its files at once and the orphan
 * sweep reclaims them.
 */
export async function deleteSiteFeedEntry(
  feed: SiteFeedDecl,
  id: SiteFeedEntryId,
): Promise<SiteFeedDeleteAnswer> {
  const deleted = await db
    .delete(siteFeedEntries)
    .where(and(eq(siteFeedEntries.id, id), eq(siteFeedEntries.feedId, feed.id)))
    .returning({ id: siteFeedEntries.id });
  return deleted.length > 0 ? { kind: "deleted" } : { kind: "absent" };
}
