import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { getConfig } from "@plugins/config_v2/server";
import { db } from "@plugins/database/server";
import { HttpError } from "@plugins/infra/plugins/endpoints/core";
import { implementMachine } from "@plugins/infra/plugins/endpoints/machine";
import { resolveHostPath } from "@plugins/infra/plugins/host-fs/server";
import { readyNow } from "@plugins/infra/plugins/deps/deps";
import { requestDep } from "@plugins/infra/plugins/deps/server";
import { ffmpeg } from "@plugins/media/plugins/ffmpeg/deps";
import {
  appendTabRecordingChunk,
  createTabRecording,
  discardTabRecording,
  finishTabRecording,
  recorderConfig,
  recordingBaseName,
} from "../../core";
import { _recorderSaves } from "../../server";
import { chunkDecision } from "./chunk-order";
import { perRecording } from "./per-recording";
import { saveRecordingJob } from "./save-job";
import { ABANDONED_AFTER_MS } from "./save-step";
import {
  createUpload,
  readUpload,
  removeUpload,
  writeChunk,
  writeCursor,
  type Upload,
} from "./upload-store";

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
      `no recording ${id ?? ""} is in ${folder} (saved, deleted, or the Recordings folder changed since it started)`,
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
    // Its save, from the start: run once the extension asks, or once the
    // browser left it without asking.
    await saveRecordingJob.enqueue(
      { id, folder },
      { runAt: new Date(Date.now() + ABANDONED_AFTER_MS) },
    );
    // The save remuxes with ffmpeg: have it installed while this records
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
      const cursor = upload.cursor;
      if (cursor === null)
        throw new HttpError(
          409,
          `recording ${upload.id} takes no more chunks: ${upload.cursorProblem ?? "it was started by an older equin"}. equin saves what it holds.`,
        );
      if (upload.finishingBy !== null || cursor.finishRequested !== null)
        throw new HttpError(
          409,
          `recording ${upload.id} is being saved: it takes no more chunks`,
        );
      const decision = chunkDecision(cursor, seq, bytes.byteLength);
      if (decision.kind === "conflict")
        throw new HttpError(409, decision.message);
      if (decision.kind === "replay") return { bytes: cursor.bytes };
      // Written at the committed end (not append mode): bytes a lost commit
      // left past it are overwritten, the file is the recording itself.
      await writeChunk(upload, bytes, cursor.bytes);
      const next = {
        ...cursor,
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
    // Behind the chunks before it in this process. The request is kept with
    // the recording (its cursor) and the save job saves it — not this
    // request — so a restart between the two loses nothing. Asking again
    // re-asserts it (the extension resends a request equin did not answer).
    perRecording.run(params.id ?? "", async () => {
      const id = params.id ?? "";
      const folder = recordingsFolder();
      const upload = await readUpload(folder, id);
      if (upload === null) {
        // Saved already: a resent request whose first try landed.
        if (await saveRecorded(id)) return;
        await uploadOf(id);
        return;
      }
      const { cursor } = upload;
      if (cursor !== null && cursor.finishRequested === null)
        await writeCursor(folder, upload.id, {
          ...cursor,
          finishRequested: { pointer: body.pointer },
        });
      await saveRecordingJob.enqueue({ id: upload.id, folder });
    }),
);

/** Whether recording `id`'s save has an outcome. */
async function saveRecorded(id: string): Promise<boolean> {
  const rows = await db
    .select({ id: _recorderSaves.id })
    .from(_recorderSaves)
    .where(eq(_recorderSaves.id, id));
  return rows.length > 0;
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
      // Its save job finds nothing left and ends.
      await removeUpload(upload);
    }),
);
