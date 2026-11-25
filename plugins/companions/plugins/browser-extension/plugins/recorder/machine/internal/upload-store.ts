import { open as openForWrite, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  readdir,
  readFile,
  stat,
} from "@plugins/packages/plugins/timed-fs/core";
import { isProcessAlive } from "@plugins/packages/plugins/process-alive/core";
import { recordingBaseName } from "../../core";
import type { ChunkCursor } from "./chunk-order";

/**
 * A recording being uploaded, as the Recordings folder holds it — never in a
 * backend's memory, so a backend that restarts (main redeploys every few
 * minutes) or a second one serving the next request picks it up where the
 * last left it. Its files, all hidden, all named by its id:
 *
 * - `.<id>.partial.mp4` — the bytes, appended chunk by chunk;
 * - `.<id>.partial.json` — its cursor: the stem it is saved under, the next
 *   chunk it takes, the last one's size and the bytes committed. Rewritten
 *   (a synced temp file renamed over it) AFTER each chunk's bytes are written
 *   and synced, so it is the commit point: bytes past `bytes` are a chunk
 *   whose cursor never landed — overwritten by that chunk's retry, cut at
 *   finish;
 * - `.<id>.finishing` — a finish's claim (the pid of the backend running
 *   it): while its process lives, the recording takes no chunk and no second
 *   finish, and is not listed as unfinished. A claim whose process died (a
 *   redeploy mid-remux) is stale: the next finish takes it over;
 * - `.<id>.mp4` — a finish's remux, before it is linked to its name.
 *
 * A partial with no cursor beside it was started by an equin that kept the
 * cursor in memory (before 2026-11-25): it takes no more chunks, but it can
 * still be saved — under its creation time — or deleted. So can one whose
 * cursor cannot be read (`cursorProblem`).
 */
export interface Upload {
  id: string;
  folder: string;
  partial: string;
  base: string;
  /** Where the upload stands; `null` for a partial from before cursors, or
   *  one whose cursor cannot be read (`cursorProblem` says why). */
  cursor: UploadCursor | null;
  cursorProblem: string | null;
  /** The bytes that are the recording: the committed ones, or (no cursor)
   *  the whole file. */
  bytes: number;
  /** The partial's last write (epoch ms). */
  writtenAt: number;
  /** The pid of a live process finishing it, or `null`. */
  finishingBy: number | null;
}

const UploadCursorSchema = z.object({
  base: z.string(),
  nextSeq: z.number().int().nonnegative(),
  lastSize: z.number().int().nonnegative().nullable(),
  bytes: z.number().int().nonnegative(),
});
export type UploadCursor = z.infer<typeof UploadCursorSchema> & ChunkCursor;

/** The ids `create` mints (`randomUUID`): nothing else names a file here. */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PARTIAL = /^\.([0-9a-f-]{36})\.partial\.mp4$/;

/** The title a partial without a cursor is saved under. */
const UNNAMED_TITLE = "Unfinished recording";

export function partialPathOf(folder: string, id: string): string {
  return join(folder, `.${id}.partial.mp4`);
}

/** Where a finish writes its remux before linking it to its name. */
export function remuxPathOf(folder: string, id: string): string {
  return join(folder, `.${id}.mp4`);
}

function cursorPathOf(folder: string, id: string): string {
  return join(folder, `.${id}.partial.json`);
}

function claimPathOf(folder: string, id: string): string {
  return join(folder, `.${id}.finishing`);
}

/** Start one: an empty partial (never overwriting) and its first cursor. */
export async function createUpload(
  folder: string,
  id: string,
  base: string,
): Promise<void> {
  await writeFile(partialPathOf(folder, id), new Uint8Array(), { flag: "wx" });
  await writeCursor(folder, id, { base, nextSeq: 0, lastSize: null, bytes: 0 });
}

/**
 * Write chunk bytes at `offset` of the partial, synced: a cursor committed
 * after this never counts bytes the disk does not hold.
 */
export async function writeChunk(
  upload: Upload,
  bytes: Uint8Array,
  offset: number,
): Promise<void> {
  const handle = await openForWrite(upload.partial, "r+");
  try {
    await handle.write(bytes, 0, bytes.byteLength, offset);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Commit a cursor: written whole and synced beside it, then renamed over. */
export async function writeCursor(
  folder: string,
  id: string,
  cursor: UploadCursor,
): Promise<void> {
  const path = cursorPathOf(folder, id);
  const temp = `${path}.tmp`;
  const handle = await openForWrite(temp, "w");
  try {
    await handle.writeFile(`${JSON.stringify(cursor)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, path);
}

/**
 * Claim recording `upload` for this process's finish: answers false when a
 * live process already holds it. A stale claim (its process died) is taken
 * over.
 */
export async function claimFinish(upload: Upload): Promise<boolean> {
  if (upload.finishingBy !== null && upload.finishingBy !== process.pid)
    return false;
  await writeFile(claimPathOf(upload.folder, upload.id), String(process.pid));
  return true;
}

/** Give a claim back (a finish that failed): the recording is unfinished again. */
export async function releaseFinish(upload: Upload): Promise<void> {
  await rm(claimPathOf(upload.folder, upload.id), { force: true });
}

/** Recording `id` in `folder`, or `null` when the folder holds none. */
export async function readUpload(
  folder: string,
  id: string,
): Promise<Upload | null> {
  if (!ID.test(id)) return null;
  const partial = partialPathOf(folder, id);
  const info = await statOrNull(partial);
  if (info === null) return null;
  const { cursor, problem } = parseCursor(
    await readOrNull(cursorPathOf(folder, id)),
  );
  // Some filesystems keep no creation time (0): the last write stands in.
  const createdAt = info.birthtimeMs > 0 ? info.birthtime : info.mtime;
  return {
    id,
    folder,
    partial,
    base: cursor?.base ?? recordingBaseName(UNNAMED_TITLE, createdAt),
    cursor,
    cursorProblem: problem,
    bytes: cursor?.bytes ?? info.size,
    writtenAt: info.mtimeMs,
    finishingBy: liveClaim(await readOrNull(claimPathOf(folder, id))),
  };
}

/** Every recording in `folder` that was never finished, newest first —
 *  without the ones a live process is finishing now. */
export async function listUploads(folder: string): Promise<Upload[]> {
  let names: string[];
  try {
    names = await readdir(folder);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const uploads: Upload[] = [];
  for (const name of names) {
    const id = PARTIAL.exec(name)?.[1];
    if (id === undefined) continue;
    // Gone between the listing and the read (finished, deleted): not unfinished.
    const upload = await readUpload(folder, id);
    if (upload !== null && upload.finishingBy === null) uploads.push(upload);
  }
  return uploads.sort((a, b) => b.writtenAt - a.writtenAt);
}

/**
 * Drop every file of it. The partial goes first: a crash part-way leaves
 * hidden leftovers nothing lists, never a partial that reads as one from
 * before cursors (and could be saved a second time).
 */
export async function removeUpload(upload: Upload): Promise<void> {
  const { folder, id } = upload;
  await rm(upload.partial, { force: true });
  await rm(remuxPathOf(folder, id), { force: true });
  await rm(`${cursorPathOf(folder, id)}.tmp`, { force: true });
  await rm(cursorPathOf(folder, id), { force: true });
  await rm(claimPathOf(folder, id), { force: true });
}

function parseCursor(text: string | null): {
  cursor: UploadCursor | null;
  problem: string | null;
} {
  if (text === null) return { cursor: null, problem: null };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return { cursor: null, problem: `its cursor is not JSON (${String(err)})` };
  }
  const parsed = UploadCursorSchema.safeParse(json);
  return parsed.success
    ? { cursor: parsed.data, problem: null }
    : {
        cursor: null,
        problem: `its cursor is malformed (${parsed.error.message})`,
      };
}

/** The pid a claim names, while that process lives; `null` otherwise. */
function liveClaim(text: string | null): number | null {
  if (text === null) return null;
  const pid = Number(text.trim());
  if (!Number.isInteger(pid) || pid <= 0) return null;
  return isProcessAlive(pid) ? pid : null;
}

async function statOrNull(path: string): Promise<{
  size: number;
  mtimeMs: number;
  mtime: Date;
  birthtimeMs: number;
  birthtime: Date;
} | null> {
  try {
    return await stat(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
