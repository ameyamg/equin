import { open } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { db } from "@plugins/database/server";
import { defineJob } from "@plugins/infra/plugins/jobs/server";
import { readyNow } from "@plugins/infra/plugins/deps/deps";
import {
  onDepInstallSettled,
  requestDep,
} from "@plugins/infra/plugins/deps/server";
import {
  ffmpeg,
  ffmpegPaths,
  type FfmpegPaths,
} from "@plugins/media/plugins/ffmpeg/deps";
import { spawnExpectOk } from "@plugins/infra/plugins/spawn/core";
import { armAwakeDeadline } from "@plugins/packages/plugins/deadline/core";
import { stat } from "@plugins/packages/plugins/timed-fs/core";
import type { PointerTrack } from "@plugins/companions/plugins/browser-extension/core";
import type { RecordingSaveOutcome } from "../../core";
import { _recorderSaves } from "../../server";
import { perRecording } from "./per-recording";
import { saveFreePair } from "./save-pair";
import { saveStep } from "./save-step";
import {
  claimFinish,
  readUpload,
  releaseFinish,
  remuxPathOf,
  removeUpload,
  type Upload,
} from "./upload-store";

/** A remux of an hour's 1440p file copies ~6 GB: minutes, never an hour. */
const REMUX_TIMEOUT_MS = 30 * 60_000;
/** ffmpeg is a ~60 MB download the first time: a bound on the network. */
const INSTALL_WAIT_MS = 15 * 60_000;

/**
 * Saves each tab recording: the one place a recording becomes a video. Every
 * recording has one run of it (keyed by its id) from the moment it starts:
 * it saves the recording once the extension asks (Stop — the request is
 * kept on disk with the recording), or once the browser left it (no chunk
 * for `ABANDONED_AFTER_MS`), and until then looks again at that deadline.
 * The input is only where the recording is, so a re-queue never loses a
 * request. A backend restarting mid-save re-runs it (the queue's sweeper):
 * a recording is never left for the user to save by hand.
 */
export const saveRecordingJob = defineJob({
  name: "recorder.save",
  description:
    "Saves each tab recording as a video in the Recordings folder once you stop it — or, when the browser left it mid-recording, what it holds — so a restart of equin never loses one.",
  hold: "minutes",
  inProcess:
    "the save is idempotent from the files on disk (truncate, remux, link): a restart mid-save re-runs it from scratch, and it holds a long-work slot only while ffmpeg remuxes.",
  input: z.object({ id: z.string(), folder: z.string() }),
  event: z.never(),
  dedup: { key: ({ id }) => id },
  run: async ({ input }) => {
    await perRecording.run(input.id, async () => {
      const upload = await readUpload(input.folder, input.id);
      const step = saveStep(upload, Date.now());
      switch (step.kind) {
        case "gone":
          return;
        case "wait":
          await saveRecordingJob.enqueue(input, { runAt: new Date(step.atMs) });
          return;
        case "empty":
          await removeUpload(upload!);
          await recordOutcome(input.id, {
            state: "failed",
            error: "Nothing was recorded: equin received no video.",
          });
          return;
        case "save": {
          if (!(await claimFinish(upload!)))
            throw new Error(
              `recording ${input.id} is being saved by process ${upload!.finishingBy}`,
            );
          try {
            const saved = await saveClaimed(upload!, step.pointer);
            await recordOutcome(input.id, { state: "saved", ...saved });
          } catch (err) {
            // Not saved: the next attempt claims it again.
            await releaseFinish(upload!);
            throw err;
          }
          return;
        }
      }
    });
  },
  // Every attempt spent: whoever waits on the save hears why. The partial
  // stays in the folder (the job's failure is reported like any job's).
  onDead: async ({ input, death }) => {
    await recordOutcome(input.id, {
      state: "failed",
      error: `The recording could not be saved: ${death.error}. What was recorded is kept in ${input.folder} as .${input.id}.partial.mp4.`,
    });
  },
});

async function recordOutcome(
  id: string,
  outcome: RecordingSaveOutcome,
): Promise<void> {
  await db
    .insert(_recorderSaves)
    .values({ id, outcome })
    .onConflictDoUpdate({ target: _recorderSaves.id, set: { outcome } });
}

/** Save a claimed recording: truncate, sync, remux, link, clean up. */
async function saveClaimed(
  upload: Upload,
  pointer: PointerTrack | null,
): Promise<{ path: string; folder: string; name: string; bytes: number }> {
  const handle = await open(upload.partial, "r+");
  try {
    // Bytes past the last commit are a chunk whose cursor never landed.
    await handle.truncate(upload.bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  const tools = await installedFfmpeg(upload.partial);
  const remuxed = remuxPathOf(upload.folder, upload.id);
  // MediaRecorder's MP4 is fragmented, with no duration up front: one copy
  // (no re-encode) moves the index to the start, so it seeks and shares.
  await spawnExpectOk(
    [
      tools.ffmpeg,
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      upload.partial,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      remuxed,
    ],
    { timeoutMs: REMUX_TIMEOUT_MS },
  );
  const name = await saveFreePair(
    remuxed,
    pointer === null ? null : `${JSON.stringify(pointer)}\n`,
    upload.folder,
    upload.base,
  );
  await removeUpload(upload);
  const path = join(upload.folder, name);
  return {
    path,
    folder: upload.folder,
    name,
    bytes: (await stat(path)).size,
  };
}

/**
 * The installed ffmpeg. The save never installs: it asks the `deps.install`
 * job for it and waits for that run to settle (the first recording on a
 * machine waits for the download).
 */
async function installedFfmpeg(partial: string): Promise<FfmpegPaths> {
  const now = await readyNow(ffmpeg);
  if (now.kind === "ready") return ffmpegPaths(now.ready);
  if (now.kind === "failed")
    throw new Error(`ffmpeg could not be installed: ${now.message}`);
  let off = (): void => {};
  let cancel = (): void => {};
  let expired = false;
  const settled = new Promise<void>((resolve) => {
    off = onDepInstallSettled(ffmpeg, resolve);
    cancel = armAwakeDeadline(INSTALL_WAIT_MS, () => {
      expired = true;
      resolve();
    });
  });
  try {
    await requestDep(ffmpeg);
    await settled;
  } finally {
    cancel();
    off();
  }
  const after = await readyNow(ffmpeg);
  if (after.kind === "ready") return ffmpegPaths(after.ready);
  throw new Error(
    expired
      ? `ffmpeg is still installing: the recording is kept as ${partial}`
      : `ffmpeg is not installed (${after.kind === "failed" ? after.message : after.kind})`,
  );
}
