import { z } from "zod";
import {
  nullable,
  type FieldsRecord,
  type FieldOptionMeta,
} from "@plugins/fields/core";
import {
  enumTextField,
  textField,
} from "@plugins/fields/plugins/text/plugins/config/core";
import { dateField } from "@plugins/fields/plugins/date/plugins/config/core";
import { jsonField } from "@plugins/fields/plugins/json/plugins/config/core";
import { idKindField } from "@plugins/ids/core";
import { entityRef } from "@plugins/infra/plugins/entities/core";
import {
  ATTACHMENT_LINKS_MAX,
  attachmentLinkFields,
} from "@plugins/infra/plugins/attachments/core";
import {
  liveCollection,
  type LiveRowsCollection,
} from "@plugins/network/plugins/live/core";
import { compositeKey } from "@plugins/network/plugins/live/plugins/query-resource/core";
import { wholeRecord } from "@plugins/packages/plugins/list-bound/core";
import { siteFeedEntryIdKind } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";

/**
 * Where an item stands on its site: `draft` — not on the box (never
 * published, or unpublished since); `published` — the box serves it.
 * What the box holds, as far as this computer last heard.
 */
export const SITE_FEED_ITEM_STATES = ["draft", "published"] as const;
export type SiteFeedItemState = (typeof SITE_FEED_ITEM_STATES)[number];

export const SITE_FEED_ITEM_STATE_META: {
  readonly [S in SiteFeedItemState]: FieldOptionMeta;
} = {
  draft: { label: "Draft", variant: "muted" },
  published: { label: "Published", variant: "success" },
};

/**
 * The publish job's side of an item: `idle` — nothing in flight;
 * `publishing` / `unpublishing` — a job is on its way to the box; `failed` —
 * the last one ended for good, `publishError` saying why.
 */
export const SITE_FEED_PUBLISH_STATES = [
  "idle",
  "publishing",
  "unpublishing",
  "failed",
] as const;
export type SiteFeedPublishState = (typeof SITE_FEED_PUBLISH_STATES)[number];

export const SITE_FEED_PUBLISH_STATE_META: {
  readonly [S in SiteFeedPublishState]: FieldOptionMeta;
} = {
  idle: { label: "Up to date", variant: "muted" },
  publishing: { label: "Publishing…", variant: "info" },
  unpublishing: { label: "Unpublishing…", variant: "info" },
  failed: { label: "Failed", variant: "destructive" },
};

/**
 * One item of a site feed, on this computer — the source of truth: drafts,
 * the published ones' current text and media. The box holds only the
 * published copy (`site-feeds/box`), written by the publish job.
 */
export const siteFeedItemFields = {
  /** The item's id here AND its entry's id on the box (`sfe-…`). */
  id: idKindField(siteFeedEntryIdKind),
  /** The deployment (site) whose feed this item belongs to. */
  deploymentId: textField({ label: "Site" }),
  /** The feed's id, as its site plugin declares it (`defineSiteFeed`). */
  feedId: textField({ label: "Feed" }),
  /**
   * One value per field of the feed's declaration, validated against it
   * (`valuesSchema`) on every write here, and again by the box on publish.
   */
  values: jsonField<Record<string, unknown>>({
    schema: wholeRecord(z.unknown(), {
      reason:
        "one item's values — one per field of its feed (at most SITE_FEED_MAX_FIELDS)",
    }),
    default: {},
  }),
  /**
   * Every text value of the item, one per line, in the feed's field order —
   * derived from `values` on every write (`siteFeedSearchText`), never set on
   * its own: what the list's search box matches, whatever the feed's fields.
   */
  searchText: textField({ label: "Text" }),
  state: enumTextField(SITE_FEED_ITEM_STATES, {
    label: "State",
    options: SITE_FEED_ITEM_STATE_META,
  }),
  /** When it was first published (the feed's order on the site); null while a draft. */
  publishedAt: nullable(dateField({ label: "Published" })),
  publishState: enumTextField(SITE_FEED_PUBLISH_STATES, {
    label: "Publishing",
    options: SITE_FEED_PUBLISH_STATE_META,
  }),
  /** Why the last publish or unpublish ended for good, in words. */
  publishError: nullable(textField({ label: "Publish error" })),
  createdAt: dateField({ label: "Created" }),
  updatedAt: dateField({ label: "Edited" }),
} satisfies FieldsRecord;

/**
 * An item's searchable text: each of its values that is text, in the feed's
 * field order, one per line. Names no field — a feed with a new text field is
 * searched by it with no change here.
 */
export function siteFeedSearchText(
  fields: FieldsRecord,
  values: Readonly<Record<string, unknown>>,
): string {
  return Object.keys(fields)
    .map((key) => values[key])
    .filter((v): v is string => typeof v === "string" && v !== "")
    .join("\n");
}

/** The `site_feed_items` entity: every feed item this computer holds. */
export const siteFeedItemsEntityRef = entityRef(
  "site_feed_items",
  siteFeedItemFields,
);

/** The `site_feed_items_attachments` link entity — built by `Attachments.defineLink`. */
export const siteFeedItemAttachmentLinksEntityRef = entityRef(
  "site_feed_items_attachments",
  attachmentLinkFields,
);

/**
 * The items of one site's feed, newest first — a bounded window every read
 * scopes to one `(deploymentId, feedId)`; `:rows` reads one item by id (the
 * editor). Values ride as a carried field: what each holds is the feed's
 * declaration's to say, so the list derives its columns from it.
 */
export const siteFeedItems = liveCollection("site-feeds.items", {
  from: siteFeedItemsEntityRef,
  pick: [
    "state",
    "publishState",
    "publishedAt",
    "updatedAt",
    "createdAt",
    "deploymentId",
    "feedId",
    "searchText",
  ],
  carry: { pick: ["id", "values", "publishError"] },
  id: "id",
  sortable: ["createdAt", "updatedAt", "publishedAt"],
  default: { orderBy: [["createdAt", "desc"]], limit: 50 },
  maxLimit: 200,
});

export type SiteFeedItemRow =
  typeof siteFeedItems extends LiveRowsCollection<infer R> ? R : never;

/** One item's attachment links, as `attachments.by-owner` follows them. */
export const siteFeedItemAttachmentLinks = liveCollection(
  "site-feeds.item-attachment-links",
  {
    from: siteFeedItemAttachmentLinksEntityRef,
    carry: { pick: ["ownerId", "attachmentId", "createdAt"] },
    baseExposures: false,
    id: compositeKey(["ownerId", "attachmentId"]),
    all: {
      by: ["ownerId"],
      orderBy: [["createdAt", "asc"]],
      max: ATTACHMENT_LINKS_MAX,
    },
  },
);
