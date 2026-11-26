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
 * What the user wants of an item: `draft` — on no copy of the site (never
 * published, or unpublished since); `published` — on every copy it was
 * published to. Where each copy actually stands is its publication's
 * (`site_feed_publications`), written by the publish jobs.
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
 * One item of a site feed, on this computer — the source of truth: drafts,
 * the published ones' current text and media. It belongs to its feed, never
 * to one deployment: every copy of the site serving the feed (this instance,
 * each deployment shipping the declaring plugin) is a destination it is
 * published to (`site_feed_publications`).
 */
export const siteFeedItemFields = {
  /** The item's id here AND its entry's id on every destination (`sfe-…`). */
  id: idKindField(siteFeedEntryIdKind),
  /** The feed's id, as its site plugin declares it (`defineSiteFeed`). */
  feedId: textField({ label: "Feed" }),
  /**
   * One value per field of the feed's declaration, validated against it
   * (`valuesSchema`) on every write here, and again by each box on publish.
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
 * The items of one feed, newest first — a bounded window every read scopes
 * to one `feedId`; `:rows` reads one item by id (the
 * editor). Values ride as a carried field: what each holds is the feed's
 * declaration's to say, so the list derives its columns from it.
 */
export const siteFeedItems = liveCollection("site-feeds.items", {
  from: siteFeedItemsEntityRef,
  pick: [
    "state",
    "publishedAt",
    "updatedAt",
    "createdAt",
    "feedId",
    "searchText",
  ],
  carry: { pick: ["id", "values"] },
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
