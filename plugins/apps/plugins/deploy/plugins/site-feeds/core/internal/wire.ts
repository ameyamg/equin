import { z } from "zod";
import { defineEndpoint } from "@plugins/infra/plugins/endpoints/core";
import {
  base64UrlJsonParamSchema,
  type HOST_ONLY_PREFIX,
} from "@plugins/apps/plugins/deploy/plugins/analytics/plugins/host-only/core";
import { cappedRecord } from "@plugins/packages/plugins/list-bound/core";
import { SITE_FEED_ID_PATTERN, SITE_FEED_MAX_FIELDS } from "./define-site-feed";
import { siteFeedEntryIdKind } from "./id-kinds";

// The box's host-only routes (`site-feeds/box`): what the computer holding a
// feed's items calls over SSH to publish them. Every refusal is an arm of the
// answer (200), never a bare status, so the caller reads WHY — the
// `unknown-set` precedent of the table mirror's routes.

export const SiteFeedIdSchema = z.string().regex(SITE_FEED_ID_PATTERN);

/**
 * An entry id (`sfe-…`): minted by the computer that holds the item (the same
 * id on the box, so publishing again is an upsert). URL-safe — it is a path
 * segment of the public media route.
 */
export const SiteFeedEntryIdSchema = siteFeedEntryIdKind.schema;

/** An attachment id as attachments mints it: a lowercase UUID. */
export const SiteFeedAttachmentIdSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    "an attachment id is a lowercase UUID",
  );

/** An entry's values on the wire: one per declared field, validated by the box. */
export const SiteFeedValuesWireSchema = cappedRecord(z.unknown(), {
  max: SITE_FEED_MAX_FIELDS,
});

/** One published entry, as the box stores and serves it. */
export const SiteFeedEntrySchema = z.object({
  id: SiteFeedEntryIdSchema,
  values: SiteFeedValuesWireSchema,
  /** ISO instant: when the item was first published (the feed's order). */
  publishedAt: z.string(),
  /** ISO instant: the box's last write of this entry. */
  updatedAt: z.string(),
});
export type SiteFeedEntryWire = z.infer<typeof SiteFeedEntrySchema>;

/** The most bytes an upsert's JSON body may carry (media are refs, not bytes). */
export const SITE_FEED_UPSERT_MAX_BYTES = 64 * 1024;

/** One zod issue, as the box reports a refused value. */
export const SiteFeedIssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])).max(16),
  message: z.string(),
});
export type SiteFeedIssue = z.infer<typeof SiteFeedIssueSchema>;

const UnknownFeedSchema = z.object({
  kind: z.literal("unknown-feed"),
  feedId: z.string(),
});

export const SiteFeedUpsertBodySchema = z.object({
  feedId: SiteFeedIdSchema,
  id: SiteFeedEntryIdSchema,
  values: SiteFeedValuesWireSchema,
  publishedAt: z.iso.datetime({ offset: true }),
});
export type SiteFeedUpsertBody = z.infer<typeof SiteFeedUpsertBodySchema>;

export const SiteFeedUpsertAnswerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("upserted"),
    id: SiteFeedEntryIdSchema,
    updatedAt: z.string(),
  }),
  UnknownFeedSchema,
  /** The values do not fit THIS box's declaration (skew: deploy the site). */
  z.object({
    kind: z.literal("invalid-values"),
    issues: z.array(SiteFeedIssueSchema).max(50),
  }),
  /** Media the values reference that were never imported here. */
  z.object({
    kind: z.literal("missing-attachments"),
    attachmentIds: z.array(z.string()).max(SITE_FEED_MAX_FIELDS * 100),
  }),
]);
export type SiteFeedUpsertAnswer = z.infer<typeof SiteFeedUpsertAnswerSchema>;

/** `POST …/entries/upsert` — publish (or re-publish) one entry. */
export const siteFeedUpsertEndpoint = defineEndpoint({
  route:
    "POST /api/host-only/site-feeds/entries/upsert" satisfies `POST ${typeof HOST_ONLY_PREFIX}${string}`,
  body: SiteFeedUpsertBodySchema,
  response: SiteFeedUpsertAnswerSchema,
  internal: {
    why: "curled on the box over SSH by the computer holding the items",
  },
});

export const SiteFeedDeleteBodySchema = z.object({
  feedId: SiteFeedIdSchema,
  id: SiteFeedEntryIdSchema,
});
export const SiteFeedDeleteAnswerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("deleted") }),
  /** Nothing to delete: already gone (a repeated unpublish). */
  z.object({ kind: z.literal("absent") }),
  UnknownFeedSchema,
]);
export type SiteFeedDeleteAnswer = z.infer<typeof SiteFeedDeleteAnswerSchema>;

/** `POST …/entries/delete` — unpublish one entry; its media links go with it. */
export const siteFeedDeleteEndpoint = defineEndpoint({
  route:
    "POST /api/host-only/site-feeds/entries/delete" satisfies `POST ${typeof HOST_ONLY_PREFIX}${string}`,
  body: SiteFeedDeleteBodySchema,
  response: SiteFeedDeleteAnswerSchema,
  internal: {
    why: "curled on the box over SSH by the computer holding the items",
  },
});

/** The most attachment ids one `media/missing` question names. */
export const SITE_FEED_MISSING_MAX_IDS = 100;

export const SiteFeedMissingQuestionSchema = z.object({
  attachmentIds: z
    .array(SiteFeedAttachmentIdSchema)
    .min(1)
    .max(SITE_FEED_MISSING_MAX_IDS),
});
export const SiteFeedMissingAnswerSchema = z.object({
  /** The asked ids this box holds no attachment for, in the asked order. */
  missing: z.array(z.string()).max(SITE_FEED_MISSING_MAX_IDS),
});

/**
 * `GET …/media/missing?q=` — which of these attachments the box lacks, so a
 * publish transfers only those (an attachment's bytes never change: one id is
 * one file).
 */
export const siteFeedMissingMediaEndpoint = defineEndpoint({
  route:
    "GET /api/host-only/site-feeds/media/missing" satisfies `GET ${typeof HOST_ONLY_PREFIX}${string}`,
  query: base64UrlJsonParamSchema(SiteFeedMissingQuestionSchema),
  response: SiteFeedMissingAnswerSchema,
});

/** A staged file's name in the box's staging dir: one plain segment. */
export const SiteFeedStagedNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)
  .refine((name) => !name.includes(".."), "no '..' in a staged name");

export const SiteFeedImportQuestionSchema = z.object({
  attachmentId: SiteFeedAttachmentIdSchema,
  filename: z.string().min(1).max(255),
  mime: z.string().min(1).max(255),
  size: z.number().int().positive(),
  /** Lowercase hex sha256 of the file's bytes, checked before import. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** The file's name in the box's staging dir (`siteFeedsStagingDir`). */
  stagedName: SiteFeedStagedNameSchema,
});
export type SiteFeedImportQuestion = z.infer<
  typeof SiteFeedImportQuestionSchema
>;

export const SiteFeedImportAnswerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("imported"), attachmentId: z.string() }),
  /** The box already held this attachment (same size): nothing was read. */
  z.object({ kind: z.literal("exists"), attachmentId: z.string() }),
  z.object({ kind: z.literal("staged-missing"), stagedName: z.string() }),
  z.object({
    kind: z.literal("size-mismatch"),
    expected: z.number(),
    actual: z.number(),
  }),
  z.object({
    kind: z.literal("sha256-mismatch"),
    expected: z.string(),
    actual: z.string(),
  }),
  /** The id holds another file here (another size): never overwritten. */
  z.object({ kind: z.literal("conflict"), message: z.string() }),
]);
export type SiteFeedImportAnswer = z.infer<typeof SiteFeedImportAnswerSchema>;

/**
 * `POST …/media/import?q=` — move a file the caller staged (scp) into the
 * box's attachments under the computer's attachment id, after checking its
 * size and sha256. The staged file is removed whatever the answer, but
 * `staged-missing`. Served by the box's machine half (it reads the disk).
 */
export const siteFeedImportMediaEndpoint = defineEndpoint({
  route:
    "POST /api/host-only/site-feeds/media/import" satisfies `POST ${typeof HOST_ONLY_PREFIX}${string}`,
  query: base64UrlJsonParamSchema(SiteFeedImportQuestionSchema),
  response: SiteFeedImportAnswerSchema,
  needsMachine: { feature: "Importing a staged site-feed file" },
  internal: {
    why: "curled on the box over SSH by the computer holding the items",
  },
});
