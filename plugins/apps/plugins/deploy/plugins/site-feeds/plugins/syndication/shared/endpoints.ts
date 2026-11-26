import { z } from "zod";
import { defineEndpoint } from "@plugins/infra/plugins/endpoints/core";
import { SiteFeedIdSchema } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import { wholeRecord } from "@plugins/packages/plugins/list-bound/core";
import { SYNDICATION_TARGET_ID_PATTERN } from "../core";

const TargetIdSchema = z.string().regex(SYNDICATION_TARGET_ID_PATTERN);

/**
 * `PUT …/syndication/settings` — one target's settings for one feed:
 * whether it is on, and the config values one edit changed (`set`, merged onto
 * the stored ones; a secret field's value goes to the secrets store). The
 * target may refuse a config it cannot use (`invalid`), and nothing is saved.
 */
export const saveSyndicationSettings = defineEndpoint({
  route: "PUT /api/deploy/site-feeds/syndication/settings",
  body: z.object({
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

/**
 * `POST …/syndication/test` — post one item to one target NOW, with the
 * target's settings as saved (whether or not it is switched on), recording
 * nothing: no row, no remote id kept — what the target answers is shown, and
 * the post stays on the target (point a test at a private channel).
 */
export const sendTestPost = defineEndpoint({
  route: "POST /api/deploy/site-feeds/syndication/test",
  body: z.object({
    feedId: SiteFeedIdSchema,
    targetId: TargetIdSchema,
    itemId: z.string().min(1),
  }),
  response: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("posted"),
      remoteId: z.string(),
      /** Where the post is seen (a message link), when the target says. */
      url: z.string().optional(),
    }),
    /** The target, or the item, refused — in words; nothing was posted. */
    z.object({ kind: z.literal("failed"), error: z.string() }),
  ]),
  needsMachine: { feature: "Sending a test post" },
});
