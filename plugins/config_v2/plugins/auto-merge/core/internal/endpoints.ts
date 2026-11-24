import { z } from "zod";
import { defineEndpoint } from "@plugins/infra/plugins/endpoints/core";

const targetSchema = z.object({
  storePath: z.string(),
  scopeId: z.string().optional(),
});

/**
 * Undo automatic merges: each target's pre-merge override and ancestor are
 * written back (the document is a normal conflict again) and its record
 * deleted. A target the registry refuses (superseded, edited since, already
 * undone) is answered in `refused` with why; the others are undone.
 */
export const undoAutoMerge = defineEndpoint({
  route: "POST /api/config-v2/auto-merge/undo",
  agentReverted: true,
  body: z.object({
    targets: z.array(targetSchema).min(1).max(500),
  }),
  response: z.object({
    refused: z.array(
      z.object({
        storePath: z.string(),
        scopeId: z.string().optional(),
        reason: z.string(),
      }),
    ),
  }),
});

/** Dismiss a document's automatic-merge note (its record `recordId`). */
export const acknowledgeAutoMerge = defineEndpoint({
  route: "POST /api/config-v2/auto-merge/ack",
  agentReverted: true,
  body: targetSchema.extend({ recordId: z.string() }),
});

/**
 * Review one top-level field of an automatic merge (the developer review):
 * `keep` the merge's decision, or rewrite the field to the user's pre-merge
 * value (`mine`) or the update's new default (`new-default`). Refused (400,
 * the registry's reason) when the record moved on, the field was edited since,
 * or the result would not fit the schema.
 */
export const resolveAutoMergeField = defineEndpoint({
  route: "POST /api/config-v2/auto-merge/resolve-field",
  agentReverted: true,
  body: targetSchema.extend({
    recordId: z.string(),
    field: z.string(),
    choice: z.enum(["keep", "mine", "new-default"]),
  }),
});
