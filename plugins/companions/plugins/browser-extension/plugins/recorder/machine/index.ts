import type { MachinePluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { DocumentHead } from "@plugins/shell/plugins/document-head/server";
import { EXTENSION_ORIGIN } from "@plugins/companions/plugins/browser-extension/core";
import {
  appendTabRecordingChunk,
  createTabRecording,
  discardTabRecording,
  finishTabRecording,
  recorderRelayApp,
} from "../core";
import {
  handleChunk,
  handleCreate,
  handleDiscard,
  handleFinish,
} from "./internal/recordings";
import { saveRecordingJob } from "./internal/save-job";
import { recordingSaveServed } from "./internal/save-served";
import { queueOrphanedSaves } from "./internal/sweep";

export default {
  description:
    "The tab recorder on the computer: the upload endpoints the relay page posts a recording through, every upload's state on disk (never in a backend's memory, so a restart or redeploy mid-recording loses nothing) — create (a hidden .<id>.partial.mp4 in the Recordings folder, its cursor in .<id>.partial.json beside it, committed after each chunk), append chunk seq (strictly in order: a replay of the last is a no-op, a gap a 409), finish (the save asked for, kept in the cursor) and discard; the recorder.save job, one per recording from its start, which saves it once asked or once its browser left it (no chunk for an hour) — fsync, an ffmpeg -c copy remux to a faststart MP4 (ffmpeg requested from infra/deps on first use), linked to `<YYYY-MM-DD HH.MM> <title>.mp4` without overwriting, the pointer track beside it — re-run by the queue after a restart, its outcome in recorder_saves; the recorder.save live value the relay page waits on; a sweep at boot giving any recording without a coming save one; and the relay page's framing policy: only the extension's own origin may frame it.",
  contributions: [
    ...recordingSaveServed.declare,
    DocumentHead.FrameAncestors({
      id: "browser-extension-recorder",
      path: recorderRelayApp.basePath,
      ancestors: [EXTENSION_ORIGIN],
    }),
  ],
  register: [saveRecordingJob],
  httpRoutes: {
    [createTabRecording.route]: handleCreate,
    [appendTabRecordingChunk.route]: handleChunk,
    [finishTabRecording.route]: handleFinish,
    [discardTabRecording.route]: handleDiscard,
  },
  onSettled: queueOrphanedSaves,
} satisfies MachinePluginDefinition;
