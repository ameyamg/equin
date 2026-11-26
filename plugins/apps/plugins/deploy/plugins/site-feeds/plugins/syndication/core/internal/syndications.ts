import { z } from "zod";
import {
  nullable,
  type FieldOptionMeta,
  type FieldsRecord,
} from "@plugins/fields/core";
import {
  enumTextField,
  textField,
} from "@plugins/fields/plugins/text/plugins/config/core";
import { dateField } from "@plugins/fields/plugins/date/plugins/config/core";
import { idKindField } from "@plugins/ids/core";
import { entityRef } from "@plugins/infra/plugins/entities/core";
import {
  liveCollection,
  liveValue,
  type LiveRowsCollection,
} from "@plugins/network/plugins/live/core";
import { compositeKey } from "@plugins/network/plugins/live/plugins/query-resource/core";
import {
  cappedRecord,
  wholeRecord,
} from "@plugins/packages/plugins/list-bound/core";
import { siteFeedEntryIdKind } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";

/** The most targets one app declares (each item's rows, each feed's settings). */
export const SYNDICATION_TARGETS_MAX = 20;

/**
 * Where one item stands on one target: `pending` — a job is on its way
 * (posting, editing or removing); `posted` — the target holds the post
 * (`remoteId`); `failed` — the last job ended for good, `error` saying why.
 * A post removed from its target leaves no row.
 */
export const SYNDICATION_STATES = ["pending", "posted", "failed"] as const;
export type SyndicationState = (typeof SYNDICATION_STATES)[number];

export const SYNDICATION_STATE_META: {
  readonly [S in SyndicationState]: FieldOptionMeta;
} = {
  pending: { label: "Sending…", variant: "info" },
  posted: { label: "Posted", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
};

/** One feed item on one target. */
export const siteFeedSyndicationFields = {
  itemId: idKindField(siteFeedEntryIdKind),
  /** The target's id (`defineSyndicationTarget`). */
  targetId: textField({ label: "Target" }),
  state: enumTextField(SYNDICATION_STATES, {
    label: "State",
    options: SYNDICATION_STATE_META,
  }),
  /** The post's id on the target (a message id), once posted. */
  remoteId: nullable(textField({ label: "Remote id" })),
  /** Why the last attempt failed, in words — kept while a retry is pending. */
  error: nullable(textField({ label: "Error" })),
  updatedAt: dateField({ label: "Updated" }),
} satisfies FieldsRecord;

export const siteFeedSyndicationsEntityRef = entityRef(
  "site_feed_syndications",
  siteFeedSyndicationFields,
);

/** One item's posts elsewhere: one row per target it was sent to. */
export const siteFeedSyndications = liveCollection("site-feeds.syndications", {
  from: siteFeedSyndicationsEntityRef,
  carry: {
    pick: ["itemId", "targetId", "state", "remoteId", "error", "updatedAt"],
  },
  baseExposures: false,
  id: compositeKey(["itemId", "targetId"]),
  all: {
    by: ["itemId"],
    orderBy: [["targetId", "asc"]],
    max: SYNDICATION_TARGETS_MAX,
  },
});

export type SiteFeedSyndicationRow =
  typeof siteFeedSyndications extends LiveRowsCollection<infer R> ? R : never;

/** One target's settings for one feed, as the browser sees them. */
export const SyndicationTargetSettingsSchema = z.object({
  enabled: z.boolean(),
  /** The non-secret config values (a secret's never leaves the computer). */
  config: wholeRecord(z.unknown(), {
    reason: "one target's config — one value per field it declares",
  }),
  /** Per secret field: whether a value is stored. */
  secretsSet: wholeRecord(z.boolean(), {
    reason: "one target's secret fields — a handful it declares",
  }),
});
export type SyndicationTargetSettings = z.infer<
  typeof SyndicationTargetSettingsSchema
>;

/**
 * Every target's settings for one feed, keyed by target id — only the
 * targets configured so far (an absent one is off, its config the defaults).
 * Served by the computer (its secrets store says which secrets are set).
 */
export const syndicationTargetSettings = liveValue(
  "site-feeds.syndication-settings",
  {
    schema: cappedRecord(SyndicationTargetSettingsSchema, {
      max: SYNDICATION_TARGETS_MAX,
    }),
    params: ["feedId"],
    needsMachine: { feature: "Reading where a feed is posted" },
  },
);

/** The settings a target has before anything is saved: off, its config the defaults. */
export function defaultTargetSettings(): SyndicationTargetSettings {
  return { enabled: false, config: {}, secretsSet: {} };
}
