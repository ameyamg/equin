import { z } from "zod";
import { blob, defineEndpoint } from "@plugins/infra/plugins/endpoints/core";
import {
  PointerTrackSchema,
  RelayCreatedSchema,
} from "@plugins/companions/plugins/browser-extension/core";

/** The recording's bytes land in a folder on the computer. */
const NEEDS_MACHINE = { feature: "Recording a tab" };

/**
 * Start a recording: a hidden `.<id>.partial.mp4` in the Recordings folder,
 * appended to chunk by chunk. `title` is the recorded tab's, for the name.
 */
export const createTabRecording = defineEndpoint({
  route: "POST /api/tab-recordings",
  body: z.object({ title: z.string().max(1000) }),
  response: RelayCreatedSchema,
  needsMachine: NEEDS_MACHINE,
});

/**
 * Append chunk `seq` (MediaRecorder's 1 s slices). `seq` must be the next one
 * — a replay of the last one (same size) is a no-op, anything else a 409:
 * chunks are never reordered.
 */
export const appendTabRecordingChunk = defineEndpoint({
  route: "POST /api/tab-recordings/:id/chunks/:seq",
  body: blob("video/mp4"),
  response: z.object({ bytes: z.number().int().nonnegative() }),
  needsMachine: NEEDS_MACHINE,
});

/**
 * Ask equin to save it: the request is kept with the recording (on disk) and
 * equin's save job runs it — flushed, remuxed to a faststart MP4, linked to
 * its final name (`<YYYY-MM-DD HH.MM> <title>.mp4`, never overwriting), with
 * the pointer track inside it (`cursorTrackBox`). Answers at once;
 * the outcome is the `recorder.save` live value. Asking again is harmless.
 */
export const finishTabRecording = defineEndpoint({
  route: "POST /api/tab-recordings/:id/finish",
  body: z.object({
    durationMs: z.number().nonnegative(),
    pointer: PointerTrackSchema.nullable(),
  }),
  needsMachine: NEEDS_MACHINE,
});

/** Drop it: the partial file is removed. */
export const discardTabRecording = defineEndpoint({
  route: "POST /api/tab-recordings/:id/discard",
  needsMachine: NEEDS_MACHINE,
});
