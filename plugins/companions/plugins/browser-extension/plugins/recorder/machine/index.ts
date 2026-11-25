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
import { unfinishedServed } from "./internal/unfinished";

export default {
  description:
    "The tab recorder on the computer: the upload endpoints the relay page posts a recording through, every upload's state on disk (never in a backend's memory, so a restart or redeploy mid-recording loses nothing) — create (a hidden .<id>.partial.mp4 in the Recordings folder, its cursor in .<id>.partial.json beside it, committed after each chunk), append chunk seq (strictly in order: a replay of the last is a no-op, a gap a 409), finish (fsync, an ffmpeg -c copy remux to a faststart MP4 — ffmpeg requested from infra/deps on first use —, linked to `<YYYY-MM-DD HH.MM> <title>.mp4` without overwriting, the pointer track beside it) and discard; the recorder.unfinished live value (the folder's recordings never finished, watched, for the panel to save or delete); and the relay page's framing policy: only the extension's own origin may frame it.",
  contributions: [
    ...unfinishedServed.declare,
    DocumentHead.FrameAncestors({
      id: "browser-extension-recorder",
      path: recorderRelayApp.basePath,
      ancestors: [EXTENSION_ORIGIN],
    }),
  ],
  httpRoutes: {
    [createTabRecording.route]: handleCreate,
    [appendTabRecordingChunk.route]: handleChunk,
    [finishTabRecording.route]: handleFinish,
    [discardTabRecording.route]: handleDiscard,
  },
} satisfies MachinePluginDefinition;
