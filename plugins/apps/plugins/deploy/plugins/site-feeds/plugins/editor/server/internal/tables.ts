import { index } from "drizzle-orm/pg-core";
import {
  defineEntity,
  defaultNow,
} from "@plugins/infra/plugins/entities/server";
import {
  siteFeedItemsEntityRef,
  siteFeedPublicationsEntityRef,
} from "../../core";

// The items of every feed this instance declares, on this computer — the
// source of truth. Built from the web-safe field record
// (`core/internal/items.ts`). An item belongs to its feed, never to one
// deployment: where it is published is `site_feed_publications`.
const siteFeedItems = defineEntity(siteFeedItemsEntityRef, {
  primaryKey: "id",
  // `updatedAt` moves when the item's content does — never for the intent
  // (publish / unpublish) or its first-publish time.
  updatedAt: {
    touchedBy: {
      id: false,
      feedId: false,
      values: true,
      searchText: false,
      state: false,
      publishedAt: false,
      createdAt: false,
    },
  },
  columns: {
    values: { default: {} },
    searchText: { default: "" },
    state: { default: "draft" },
    createdAt: { default: defaultNow() },
    updatedAt: { default: defaultNow() },
  },
  indexes: (t) => [
    // The editor's whole read: one feed, newest first.
    index("site_feed_items_feed_created_idx").on(t.feedId, t.createdAt.desc()),
  ],
});

export const _siteFeedItems = siteFeedItems.table;
export { siteFeedItems as siteFeedItemsEntity };

// One item on one destination (`local` or `deployment:<id>`); goes with its
// item. No foreign key to the deployment: `local` has no row, and a
// deployment's removal leaves its rows to be shown as a destination that no
// longer exists (the job refuses it in words).
const siteFeedPublications = defineEntity(siteFeedPublicationsEntityRef, {
  primaryKey: ["itemId", "destination"],
  updatedAt: {
    touchedBy: {
      itemId: false,
      destination: false,
      state: true,
      error: true,
      publishedAt: true,
    },
  },
  columns: {
    itemId: {
      references: { column: () => _siteFeedItems.id, onDelete: "cascade" },
    },
    state: { default: "publishing" },
    updatedAt: { default: defaultNow() },
  },
});

export const _siteFeedPublications = siteFeedPublications.table;
export { siteFeedPublications as siteFeedPublicationsEntity };
