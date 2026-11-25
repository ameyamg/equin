import { z } from "zod";
import { defineEndpoint } from "@plugins/infra/plugins/endpoints/core";
import { SiteFeedIdSchema } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import { wholeRecord } from "@plugins/packages/plugins/list-bound/core";
import { SYNDICATION_TARGET_ID_PATTERN } from "../core";

const TargetIdSchema = z.string().regex(SYNDICATION_TARGET_ID_PATTERN);

/**
 * `PUT …/syndication/settings` — one target's settings for one site's feed:
 * whether it is on, and the config values one edit changed (`set`, merged onto
 * the stored ones; a secret field's value goes to the secrets store). The
 * target may refuse a config it cannot use (`invalid`), and nothing is saved.
 */
export const saveSyndicationSettings = defineEndpoint({
  route: "PUT /api/deploy/site-feeds/syndication/settings",
  body: z.object({
    deploymentId: z.string().min(1),
    feedId: SiteFeedIdSchema,
    targetId: TargetIdSchema,
    enabled: z.boolean().optional(),
    set: wholeRecord(z.unknown(), {
      reason:
        "the config fields one edit changed — at most every field the target declares",
    }),
  }),
  response: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("saved") }),
    z.object({ kind: z.literal("invalid"), message: z.string() }),
    z.object({ kind: z.literal("unknown-target"), targetId: z.string() }),
  ]),
  needsMachine: { feature: "Saving where a feed is posted" },
});

/**
 * `POST …/syndication/retry` — send one item to one target again (post, edit
 * or remove, whichever its state asks), now.
 */
export const retrySyndication = defineEndpoint({
  route: "POST /api/deploy/site-feeds/syndication/retry",
  body: z.object({ itemId: z.string().min(1), targetId: TargetIdSchema }),
  response: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("queued") }),
    /** The item is neither published nor still posted there: nothing to send. */
    z.object({ kind: z.literal("nothing-to-do") }),
  ]),
  needsMachine: { feature: "Posting a feed item elsewhere" },
});
