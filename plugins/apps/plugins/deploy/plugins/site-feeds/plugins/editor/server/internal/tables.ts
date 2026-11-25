import { index } from "drizzle-orm/pg-core";
import {
  defineEntity,
  defaultNow,
} from "@plugins/infra/plugins/entities/server";
import { _deployDeployments } from "@plugins/apps/plugins/deploy/plugins/deployments/server";
import { siteFeedItemsEntityRef } from "../../core";

// The items of every site's feeds, on this computer — the source of truth.
// Built from the web-safe field record (`core/internal/items.ts`); an item
// goes with its deployment.
const siteFeedItems = defineEntity(siteFeedItemsEntityRef, {
  primaryKey: "id",
  // `updatedAt` moves when the item's content does — never for the publish
  // job's own bookkeeping.
  updatedAt: {
    touchedBy: {
      id: false,
      deploymentId: false,
      feedId: false,
      values: true,
      searchText: false,
      state: false,
      publishedAt: false,
      publishState: false,
      publishError: false,
      createdAt: false,
    },
  },
  columns: {
    deploymentId: {
      references: {
        column: () => _deployDeployments.id,
        onDelete: "cascade",
      },
    },
    values: { default: {} },
    searchText: { default: "" },
    state: { default: "draft" },
    publishState: { default: "idle" },
    createdAt: { default: defaultNow() },
    updatedAt: { default: defaultNow() },
  },
  indexes: (t) => [
    // The editor's whole read: one site's feed, newest first.
    index("site_feed_items_deployment_feed_created_idx").on(
      t.deploymentId,
      t.feedId,
      t.createdAt.desc(),
    ),
  ],
});

export const _siteFeedItems = siteFeedItems.table;
export { siteFeedItems as siteFeedItemsEntity };
