import { desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db } from "@plugins/database/server";
import { serveValue } from "@plugins/network/plugins/live/server";
import type { SiteFeedDecl } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import {
  siteFeedEntries as siteFeedEntriesValue,
  type SiteFeedEntries,
} from "../../core";
import { SiteFeeds, siteFeedOf } from "./registry";
import { siteFeedEntries } from "./tables";

/** A stored entry no longer fits its feed's declaration (a field changed type). */
export class StoredEntryInvalidError extends Error {
  override name = "StoredEntryInvalidError";
}

/**
 * One feed's newest `publicLimit` entries, each one's values re-read through
 * the feed's declaration: a field added since the entry was written takes its
 * default, a field removed is dropped. An entry that no longer parses throws
 * — the feed fails loudly (reported) rather than silently hiding an entry.
 * `exec` is the app's `db`, or a test database.
 */
export async function readFeedEntries(
  exec: NodePgDatabase,
  feed: SiteFeedDecl,
): Promise<SiteFeedEntries> {
  const rows = await exec
    .select()
    .from(siteFeedEntries)
    .where(eq(siteFeedEntries.feedId, feed.id))
    .orderBy(desc(siteFeedEntries.publishedAt), desc(siteFeedEntries.id))
    .limit(feed.publicLimit);
  return {
    entries: rows.map((row) => {
      const parsed = feed.valuesSchema.safeParse(row.values);
      if (!parsed.success) {
        throw new StoredEntryInvalidError(
          `site-feeds: entry ${row.id} of feed "${feed.id}" no longer fits its declaration — ${parsed.error.message}`,
        );
      }
      return {
        id: row.id,
        values: parsed.data as Record<string, unknown>,
        publishedAt: row.publishedAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    }),
  };
}

export const siteFeedEntriesServed = serveValue(siteFeedEntriesValue, {
  source: "db",
  reads: {
    tables: [siteFeedEntries],
    reason: "a feed's newest published entries",
  },
  // A visitor reads a feed this release declares; any other id is no
  // tuple of this site's.
  visitorTuple: ({ feedId }) => siteFeedOf(feedId) !== null,
  // Every feed this release declares, under the plugin that declared it —
  // the one whose page renders it — so a composition whose browser does not
  // load that plugin carries no tuple.
  preloadParams: () =>
    SiteFeeds.Feed.getContributions().map((c) => {
      if (c._pluginId === undefined) {
        throw new Error(
          `site-feeds: feed "${c.feed.id}" was contributed without its plugin id`,
        );
      }
      return { plugin: c._pluginId, value: { feedId: c.feed.id } };
    }),
  loader: async ({ feedId }) => {
    const feed = siteFeedOf(feedId);
    if (feed === null) {
      throw siteFeedEntriesValue.refuse(
        "unknown-feed",
        `This site declares no feed "${feedId}"`,
      );
    }
    return readFeedEntries(db, feed);
  },
});
