import { z } from "zod";
import { liveValue } from "@plugins/network/plugins/live/core";
import { wholeList } from "@plugins/packages/plugins/list-bound/core";

/**
 * A recording in the Recordings folder whose finish never came: its hidden
 * `.<id>.partial.mp4` (the browser closed mid-recording, the extension was
 * reloaded, a finish failed). `name` is the stem it will be saved under;
 * `bytes`, what it holds; `writtenAt`, its last chunk (epoch ms).
 */
export const UnfinishedRecordingSchema = z.object({
  id: z.string(),
  name: z.string(),
  bytes: z.number().int().nonnegative(),
  writtenAt: z.number(),
});
export type UnfinishedRecording = z.infer<typeof UnfinishedRecordingSchema>;

/**
 * The Recordings folder's unfinished recordings, newest first — read by the
 * panel, which offers to save or delete each while nothing is recording. A
 * recording still being uploaded is in it too (the folder cannot tell one
 * from the other: only the extension knows its own).
 */
export const unfinishedTabRecordings = liveValue("recorder.unfinished", {
  schema: z.object({
    recordings: wholeList(UnfinishedRecordingSchema, {
      reason:
        "the recordings in one folder that were never finished — one per interrupted recording, cleared by Save or Delete",
    }),
  }),
  needsMachine: { feature: "Recording a tab" },
});
