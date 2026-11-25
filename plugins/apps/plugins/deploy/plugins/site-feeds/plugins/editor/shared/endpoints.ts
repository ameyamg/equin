import { z } from "zod";
import { defineEndpoint } from "@plugins/infra/plugins/endpoints/core";
import {
  SiteFeedIdSchema,
  SiteFeedIssueSchema,
  SiteFeedValuesWireSchema,
} from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";

// The editor's writes. Reads are the live `site-feeds.items` collection.

/** `POST …/items` — a new draft of a feed of a site, its values the declaration's defaults. */
export const createSiteFeedItem = defineEndpoint({
  route: "POST /api/deploy/site-feeds/items",
  body: z.object({ deploymentId: z.string().min(1), feedId: SiteFeedIdSchema }),
  response: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("created"), id: z.string() }),
    /** No plugin of this app declares the feed (its site plugin was removed). */
    z.object({ kind: z.literal("unknown-feed"), feedId: z.string() }),
  ]),
});

const UpdateAnswerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("saved") }),
  /** The values do not fit the feed's declaration: nothing was written. */
  z.object({
    kind: z.literal("invalid-values"),
    issues: z.array(SiteFeedIssueSchema).max(50),
  }),
  z.object({ kind: z.literal("unknown-feed"), feedId: z.string() }),
]);
export type UpdateSiteFeedItemAnswer = z.infer<typeof UpdateAnswerSchema>;

/**
 * `PATCH …/items/:id` — autosave of the fields one edit changed (`set`),
 * merged onto the stored values by the server, so two edits in flight at once
 * (a title typed while a video uploads) both land — the form never sends
 * values it read before the other edit. A published item is published again.
 */
export const updateSiteFeedItem = defineEndpoint({
  route: "PATCH /api/deploy/site-feeds/items/:id",
  body: z.object({ set: SiteFeedValuesWireSchema }),
  response: UpdateAnswerSchema,
  // Served by the machine half: a published item's edit queues its publish job.
  needsMachine: { feature: "Editing a site feed item" },
});

/** `DELETE …/items/:id` — a draft only: a published item is unpublished first. */
export const deleteSiteFeedItem = defineEndpoint({
  route: "DELETE /api/deploy/site-feeds/items/:id",
  response: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("deleted") }),
    z.object({ kind: z.literal("published") }),
    z.object({ kind: z.literal("busy") }),
  ]),
});

const QueuedAnswerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("queued") }),
  /** An unpublish (for a publish) or publish (for an unpublish) is in flight. */
  z.object({ kind: z.literal("busy") }),
]);

/** `POST …/items/:id/publish` — queue the publish job (media, then the entry). */
export const publishSiteFeedItem = defineEndpoint({
  route: "POST /api/deploy/site-feeds/items/:id/publish",
  response: QueuedAnswerSchema,
  needsMachine: { feature: "Publishing a site feed item" },
});

/** `POST …/items/:id/unpublish` — queue the job that deletes the entry on the box. */
export const unpublishSiteFeedItem = defineEndpoint({
  route: "POST /api/deploy/site-feeds/items/:id/unpublish",
  response: QueuedAnswerSchema,
  needsMachine: { feature: "Unpublishing a site feed item" },
});
