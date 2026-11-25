import { randomUUID } from "node:crypto";
import { mkdir, open, rm, writeFile } from "node:fs/promises";
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
import { chunkDecision, type ChunkCursor } from "./chunk-order";
import { saveFreePair } from "./save-pair";

/**
 * The recordings being uploaded, by id. In memory: a recording lives as long
 * as the backend that took its first chunk — after a restart its id answers
 * 404 and the extension says the recording failed; the `.partial.mp4` it left
 * stays in the folder, remuxable by hand.
 */
interface Upload extends ChunkCursor {
  folder: string;
  partial: string;
  base: string;
  bytes: number;
}
const uploads = new Map<string, Upload>();

/** A remux of an hour's 1440p file copies ~6 GB: minutes, never an hour. */
const REMUX_TIMEOUT_MS = 30 * 60_000;
/** ffmpeg is a ~60 MB download the first time: a bound on the network. */
const INSTALL_WAIT_MS = 15 * 60_000;

function uploadOf(id: string | undefined): Upload {
  const upload = id === undefined ? undefined : uploads.get(id);
  if (upload === undefined)
    throw new HttpError(404, `no recording ${id ?? ""} is being uploaded here`);
  return upload;
}

export const handleCreate = implementMachine(
  createTabRecording,
  async ({ body }) => {
    const configured = getConfig(recorderConfig).folder;
    if (configured === "")
      throw new HttpError(
        400,
        "No Recordings folder is set (Settings → Config → Recorder).",
      );
    const folder = resolveHostPath(configured);
    await mkdir(folder, { recursive: true });
    const id = randomUUID();
    const partial = join(folder, `.${id}.partial.mp4`);
    await writeFile(partial, new Uint8Array(), { flag: "wx" });
    uploads.set(id, {
      folder,
      partial,
      base: recordingBaseName(body.title, new Date()),
      bytes: 0,
      nextSeq: 0,
      lastSize: null,
    });
    // The finish remuxes with ffmpeg: have it installed while this records
    // (a first recording would otherwise wait for the download at Stop).
    if ((await readyNow(ffmpeg)).kind !== "ready") await requestDep(ffmpeg);
    return { recordingId: id, folder };
  },
);

export const handleChunk = implementMachine(
  appendTabRecordingChunk,
  async ({ body, params }) => {
    const upload = uploadOf(params.id);
    const seq = Number(params.seq);
    if (!Number.isInteger(seq) || seq < 0) throw new HttpError(400, "bad seq");
    const bytes = new Uint8Array(await body.arrayBuffer());
    const decision = chunkDecision(upload, seq, bytes.byteLength);
    if (decision.kind === "conflict")
      throw new HttpError(409, decision.message);
    if (decision.kind === "append") {
      // Written at the file's known end (not append mode): the file is the
      // recording itself, bounded by its length, not a growing log.
      const handle = await open(upload.partial, "r+");
      try {
        await handle.write(bytes, 0, bytes.byteLength, upload.bytes);
      } finally {
        await handle.close();
      }
      upload.nextSeq = seq + 1;
      upload.lastSize = bytes.byteLength;
      upload.bytes += bytes.byteLength;
    }
    return { bytes: upload.bytes };
  },
);

export const handleFinish = implementMachine(
  finishTabRecording,
  async ({ body, params }) => {
    const id = params.id;
    const upload = uploadOf(id);
    if (upload.nextSeq === 0)
      throw new HttpError(409, "the recording has no chunk");
    // Claimed at once: a second finish (or a chunk, or a discard) of this id
    // answers 404 instead of remuxing and saving the same partial again. A
    // finish that fails from here leaves the partial in the folder, as a
    // restart does.
    uploads.delete(id);
    const handle = await open(upload.partial, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    const tools = await installedFfmpeg(upload.partial);
    const remuxed = join(upload.folder, `.${id}.mp4`);
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
      body.pointer === null ? null : `${JSON.stringify(body.pointer)}\n`,
      upload.folder,
      upload.base,
    );
    await rm(remuxed);
    await rm(upload.partial);
    const path = join(upload.folder, name);
    return {
      path,
      folder: upload.folder,
      name,
      bytes: (await stat(path)).size,
    };
  },
);

export const handleDiscard = implementMachine(
  discardTabRecording,
  async ({ params }) => {
    const upload = uploadOf(params.id);
    uploads.delete(params.id ?? "");
    await rm(upload.partial, { force: true });
  },
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
