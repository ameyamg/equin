import { z } from "zod";
import { liveValue } from "@plugins/network/plugins/live/core";

/**
 * What came of saving a recording, once equin's save job is done with it:
 * the video (where it landed) or why it could not be saved, every attempt
 * spent. Written by the job, read by the relay page to answer the
 * extension's finish.
 */
export const RecordingSaveOutcomeSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("saved"),
    path: z.string(),
    folder: z.string(),
    name: z.string(),
    bytes: z.number().int().nonnegative(),
  }),
  z.object({ state: z.literal("failed"), error: z.string() }),
]);
export type RecordingSaveOutcome = z.infer<typeof RecordingSaveOutcomeSchema>;

/**
 * Recording `id`'s save: `pending` while the job has not ended (queued,
 * remuxing, or re-run after a backend restart), then its outcome.
 */
export const recordingSave = liveValue("recorder.save", {
  schema: z.union([
    z.object({ state: z.literal("pending") }),
    RecordingSaveOutcomeSchema,
  ]),
  params: ["id"],
  needsMachine: { feature: "Recording a tab" },
});
