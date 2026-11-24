import { z } from "zod";
import { liveValue } from "@plugins/network/plugins/live/core";
import { wholeList } from "@plugins/packages/plugins/list-bound/core";
import { configMergeRecordSchema } from "@plugins/config_v2/core";

const statusSchema = z.enum(["current", "superseded", "edited", "undone"]);

/**
 * One automatic merge, as the list of them shows it: which document, when,
 * where it stands (`current` — Undo puts the conflict back; `superseded` — a
 * later update moved past it; `edited` — the user changed the document
 * since; `undone` — the user undid it, kept so the update is not merged
 * again), how many notes it left and the fields it dropped.
 */
export const autoMergeSummarySchema = z.object({
  path: z.string(),
  scopeId: z.string().optional(),
  id: z.string(),
  mergedAt: z.string(),
  status: statusSchema,
  notes: z.number().int(),
  removedFields: wholeList(z.string(), {
    reason: "the fields one config document's merge dropped — its fields",
  }),
  acknowledgedAt: z.string().optional(),
  notifiedAt: z.string().optional(),
});
export type AutoMergeSummary = z.infer<typeof autoMergeSummarySchema>;

/**
 * Every config document with an automatic-merge record (`<name>.merge.jsonc`),
 * base and app scopes. Read from the store on every load; notified whenever a
 * document moves (`onDocumentChange`) or a record is stamped.
 */
export const configAutoMerges = liveValue("config-v2.auto-merges", {
  schema: wholeList(autoMergeSummarySchema, {
    reason:
      "one per config document merged automatically — at most one per registered descriptor and scope (~250)",
  }),
});

export const autoMergeStateSchema = z
  .object({ record: configMergeRecordSchema, status: statusSchema })
  .nullable();
export type AutoMergeStateView = z.infer<typeof autoMergeStateSchema>;

/** One document's merge record and where it stands, or null when it has none. */
export const configAutoMerge = liveValue("config-v2.auto-merge", {
  schema: autoMergeStateSchema,
  params: ["path", "scopeId?"],
});
