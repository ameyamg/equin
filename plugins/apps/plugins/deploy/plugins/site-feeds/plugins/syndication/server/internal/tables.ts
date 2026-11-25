import { z } from "zod";
import {
  defineEntity,
  defaultNow,
} from "@plugins/infra/plugins/entities/server";
import { entityRef } from "@plugins/infra/plugins/entities/core";
import type { FieldsRecord } from "@plugins/fields/core";
import { textField } from "@plugins/fields/plugins/text/plugins/config/core";
import { boolField } from "@plugins/fields/plugins/bool/plugins/config/core";
import { dateField } from "@plugins/fields/plugins/date/plugins/config/core";
import { jsonField } from "@plugins/fields/plugins/json/plugins/config/core";
import { wholeRecord } from "@plugins/packages/plugins/list-bound/core";
import { _deployDeployments } from "@plugins/apps/plugins/deploy/plugins/deployments/server";
import { _siteFeedItems } from "@plugins/apps/plugins/deploy/plugins/site-feeds/plugins/editor/server";
import { siteFeedSyndicationsEntityRef } from "../../core";

// One item on one target; goes with its item.
const siteFeedSyndications = defineEntity(siteFeedSyndicationsEntityRef, {
  primaryKey: ["itemId", "targetId"],
  updatedAt: {
    touchedBy: {
      itemId: false,
      targetId: false,
      state: true,
      remoteId: true,
      error: true,
    },
  },
  columns: {
    itemId: {
      references: { column: () => _siteFeedItems.id, onDelete: "cascade" },
    },
    state: { default: "pending" },
    updatedAt: { default: defaultNow() },
  },
});

export const _siteFeedSyndications = siteFeedSyndications.table;
export { siteFeedSyndications as siteFeedSyndicationsEntity };

const settingsFields = {
  deploymentId: textField({ label: "Site" }),
  feedId: textField({ label: "Feed" }),
  targetId: textField({ label: "Target" }),
  enabled: boolField({ label: "On" }),
  /**
   * The target's non-secret config values (its secret fields live in the
   * secrets store, namespace `site-feeds`), read through the target's
   * declaration — a field added since takes its default.
   */
  config: jsonField<Record<string, unknown>>({
    schema: wholeRecord(z.unknown(), {
      reason: "one target's config — one value per field it declares",
    }),
    default: {},
  }),
  updatedAt: dateField({ label: "Updated" }),
} satisfies FieldsRecord;

// One target's settings for one site's feed; goes with its deployment.
const siteFeedSyndicationSettings = defineEntity(
  entityRef("site_feed_syndication_settings", settingsFields),
  {
    primaryKey: ["deploymentId", "feedId", "targetId"],
    updatedAt: {
      touchedBy: {
        deploymentId: false,
        feedId: false,
        targetId: false,
        enabled: true,
        config: true,
      },
    },
    columns: {
      deploymentId: {
        references: {
          column: () => _deployDeployments.id,
          onDelete: "cascade",
        },
      },
      enabled: { default: false },
      config: { default: {} },
      updatedAt: { default: defaultNow() },
    },
  },
);

export const _siteFeedSyndicationSettings = siteFeedSyndicationSettings.table;
