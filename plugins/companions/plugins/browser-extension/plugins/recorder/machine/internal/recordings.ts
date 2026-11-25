import { randomUUID } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { stat } from "@plugins/packages/plugins/timed-fs/core";
import { join } from "node:path";
import { getConfig } from "@plugins/config_v2/server";
import { HttpError } from "@plugins/infra/plugins/endpoints/core";
import { implementMachine } from "@plugins/infra/plugins/endpoints/machine";
import { resolveHostPath } from "@plugins/infra/plugins/host-fs/server";
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
import {
  appendTabRecordingChunk,
  createTabRecording,
  discardTabRecording,
  finishTabRecording,
  recorderConfig,
  recordingBaseName,
} from "../../core";
import { createKeyedMutex } from "@plugins/packages/plugins/keyed-mutex/core";
import { chunkDecision } from "./chunk-order";
import {
  claimFinish,
  createUpload,
  readUpload,
  releaseFinish,
  remuxPathOf,
  removeUpload,
  writeChunk,
  writeCursor,
  type Upload,
} from "./upload-store";
import type { PointerTrack } from "@plugins/companions/plugins/browser-extension/core";
import { unfinishedServed } from "./unfinished";
import { saveFreePair } from "./save-pair";

/** A remux of an hour's 1440p file copies ~6 GB: minutes, never an hour. */
const REMUX_TIMEOUT_MS = 30 * 60_000;
/** ffmpeg is a ~60 MB download the first time: a bound on the network. */
const INSTALL_WAIT_MS = 15 * 60_000;

/**
 * One request at a time per recording in this process: a chunk's read of the
 * cursor, its write and its commit are one step, and a finish or discard runs
 * after the chunks before it. (Across processes the relay is the order: it
 * sends one request at a time, so a request reaches the next backend only
 * once the last one answered.)
 */
const perRecording = createKeyedMutex("tab-recordings");

/** The configured Recordings folder, resolved; a 400 when none is set. */
function recordingsFolder(): string {
  const configured = getConfig(recorderConfig).folder;
  if (configured === "")
    throw new HttpError(
      400,
      "No Recordings folder is set (Settings → Config → Recorder).",
    );
  return resolveHostPath(configured);
}

/** Recording `id` as the Recordings folder holds it; a 404 when it holds none. */
async function uploadOf(id: string | undefined): Promise<Upload> {
  const folder = recordingsFolder();
  const upload = id === undefined ? null : await readUpload(folder, id);
  if (upload === null)
    throw new HttpError(
      404,
      `no recording ${id ?? ""} is in ${folder} (finished, deleted, or the Recordings folder changed since it started)`,
    );
  return upload;
}

export const handleCreate = implementMachine(
  createTabRecording,
  async ({ body }) => {
    const folder = recordingsFolder();
    await mkdir(folder, { recursive: true });
    const id = randomUUID();
    await createUpload(folder, id, recordingBaseName(body.title, new Date()));
    unfinishedServed.notify();
    // The finish remuxes with ffmpeg: have it installed while this records
    // (a first recording would otherwise wait for the download at Stop).
    if ((await readyNow(ffmpeg)).kind !== "ready") await requestDep(ffmpeg);
    return { recordingId: id, folder };
  },
);

export const handleChunk = implementMachine(
  appendTabRecordingChunk,
  async ({ body, params }) => {
    const seq = Number(params.seq);
    if (!Number.isInteger(seq) || seq < 0) throw new HttpError(400, "bad seq");
    const bytes = new Uint8Array(await body.arrayBuffer());
    return perRecording.run(params.id ?? "", async () => {
      const upload = await uploadOf(params.id);
      if (upload.finishingBy !== null)
        throw new HttpError(
          409,
          `recording ${upload.id} is being saved (by process ${upload.finishingBy}): it takes no more chunks`,
        );
      const cursor = upload.cursor;
      if (cursor === null)
        throw new HttpError(
          409,
          `recording ${upload.id} takes no more chunks: ${upload.cursorProblem ?? "it was started by an older equin"}. Save it from Unfinished recordings in the extension's panel.`,
        );
      const decision = chunkDecision(cursor, seq, bytes.byteLength);
      if (decision.kind === "conflict")
        throw new HttpError(409, decision.message);
      if (decision.kind === "replay") return { bytes: cursor.bytes };
      // Written at the committed end (not append mode): bytes a lost commit
      // left past it are overwritten, the file is the recording itself.
      await writeChunk(upload, bytes, cursor.bytes);
      const next = {
        base: cursor.base,
        nextSeq: seq + 1,
        lastSize: bytes.byteLength,
        bytes: cursor.bytes + bytes.byteLength,
      };
      await writeCursor(upload.folder, upload.id, next);
      return { bytes: next.bytes };
    });
  },
);

export const handleFinish = implementMachine(
  finishTabRecording,
  async ({ body, params }) =>
    // Behind the chunks before it in this process; a second finish of the
    // same id waits for the first and then answers 404 (its files are gone).
    // Across processes the claim decides: one finish at a time.
    perRecording.run(params.id ?? "", async () => {
      const upload = await uploadOf(params.id);
      if (upload.bytes === 0)
        throw new HttpError(409, "the recording has no chunk");
      if (!(await claimFinish(upload)))
        throw new HttpError(
          409,
          `recording ${upload.id} is already being saved (by process ${upload.finishingBy})`,
        );
      unfinishedServed.notify();
      try {
        return await finishClaimed(upload, body.pointer);
      } catch (err) {
        // Not saved: unfinished again, to be saved from the panel. A finish
        // cut by its process dying leaves a stale claim, taken over likewise.
        await releaseFinish(upload);
        unfinishedServed.notify();
        throw err;
      }
    }),
);

/** Finish a claimed recording: truncate, sync, remux, link, clean up. */
async function finishClaimed(
  upload: Upload,
  pointer: PointerTrack | null,
): Promise<{ path: string; folder: string; name: string; bytes: number }> {
  const id = upload.id;
  const handle = await open(upload.partial, "r+");
  try {
    // Bytes past the last commit are a chunk whose cursor never landed.
    await handle.truncate(upload.bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  // A finish that fails from here leaves the recording in the folder,
  // listed as unfinished, to be saved again.
  const tools = await installedFfmpeg(upload.partial);
  const remuxed = remuxPathOf(upload.folder, id);
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
  unfinishedServed.notify();
  const path = join(upload.folder, name);
  return {
    path,
    folder: upload.folder,
    name,
    bytes: (await stat(path)).size,
  };
}

export const handleDiscard = implementMachine(
  discardTabRecording,
  async ({ params }) =>
    perRecording.run(params.id ?? "", async () => {
      const upload = await uploadOf(params.id);
      if (upload.finishingBy !== null)
        throw new HttpError(
          409,
          `recording ${upload.id} is being saved (by process ${upload.finishingBy}): delete the video once it is saved`,
        );
      await removeUpload(upload);
      unfinishedServed.notify();
    }),
);

/**
 * The installed ffmpeg. A request path never installs: it asks the
 * `deps.install` job for it and waits for that run to settle (the first
 * recording on a machine waits for the download).
 */
async function installedFfmpeg(partial: string): Promise<FfmpegPaths> {
  const now = await readyNow(ffmpeg);
  if (now.kind === "ready") return ffmpegPaths(now.ready);
  if (now.kind === "failed")
    throw new HttpError(503, `ffmpeg could not be installed: ${now.message}`);
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
  throw new HttpError(
    503,
    expired
      ? `ffmpeg is still installing: the recording is kept as ${partial}`
      : `ffmpeg is not installed (${after.kind === "failed" ? after.message : after.kind})`,
  );
}
