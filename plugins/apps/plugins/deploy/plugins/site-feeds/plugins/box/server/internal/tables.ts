import { z } from "zod";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { parsedJson } from "@plugins/database/plugins/sql-column/server";
import {
  deriveUpdatedAt,
  derivedUpdatedAt,
} from "@plugins/database/plugins/derived-updated-at/server";
import { idColumn } from "@plugins/ids/server";
import { siteFeedEntryIdKind } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";

/**
 * An entry's values as stored: one key per declared field, every key kept.
 * What each value is, is the feed declaration's to say (`valuesSchema`), read
 * on every write and every public read — the column only vouches it is an object.
 */
const StoredValuesSchema = z.record(z.string(), z.unknown());

/**
 * One published entry of a site feed — the box's copy. The computer holding
 * the feed's items is the source of truth (its editor writes them here through
 * the host-only upsert); losing this table loses nothing but the published
 * state, which publishing again restores.
 *
 * `id` is the item's id on that computer (`sfe-…`), unique across feeds, so a
 * re-publish is an upsert and the entry owns its media links on its own.
 * `values` were validated against THIS release's feed declaration on write.
 * `updated_at` is derived: it moves when the published content does.
 */
export const siteFeedEntries = deriveUpdatedAt(
  pgTable(
    "site_feed_entries",
    {
      id: idColumn(siteFeedEntryIdKind),
      feedId: text("feed_id").notNull(),
      values: parsedJson("values", StoredValuesSchema).notNull(),
      publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
      updatedAt: derivedUpdatedAt(),
    },
    (t) => [
      index("site_feed_entries_feed_published_idx").on(t.feedId, t.publishedAt),
    ],
  ),
  {
    touchedBy: {
      values: true,
      publishedAt: true,
      feedId: false,
      id: false,
    },
  },
);
