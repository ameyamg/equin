import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claimFinish,
  createUpload,
  listUploadIds,
  partialPathOf,
  readUpload,
  releaseFinish,
  removeUpload,
  writeCursor,
} from "./upload-store";

const ID = "df861715-4089-4065-bf01-8fa6784224a8";
let folder: string;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "upload-store-"));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe("upload-store", () => {
  test("an upload is read back from disk alone — what a new backend sees", async () => {
    await createUpload(folder, ID, "2026-11-25 13.50 Plan");
    const cursor = {
      base: "2026-11-25 13.50 Plan",
      nextSeq: 3,
      lastSize: 10,
      bytes: 30,
      finishRequested: { pointer: null },
    };
    await writeCursor(folder, ID, cursor);
    const upload = await readUpload(folder, ID);
    expect(upload?.cursor).toEqual(cursor);
    expect(upload?.bytes).toBe(30);
  });

  test("a cursor from before finishRequested asked for no save", async () => {
    await createUpload(folder, ID, "a");
    await writeFile(
      join(folder, `.${ID}.partial.json`),
      JSON.stringify({ base: "a", nextSeq: 1, lastSize: 4, bytes: 4 }),
    );
    expect((await readUpload(folder, ID))?.cursor?.finishRequested).toBeNull();
  });

  test("a partial from before cursors is read with its own size and no cursor", async () => {
    await writeFile(partialPathOf(folder, ID), new Uint8Array(12));
    const upload = await readUpload(folder, ID);
    expect(upload?.cursor).toBeNull();
    expect(upload?.bytes).toBe(12);
    expect(upload?.base).toMatch(/^\d{4}-\d\d-\d\d \d\d\.\d\d Recording$/);
  });

  test("an id that is not one create mints names no file", async () => {
    expect(await readUpload(folder, "../../etc/passwd")).toBeNull();
    expect(await readUpload(folder, ID)).toBeNull();
  });

  test("list finds every recording not saved yet; remove drops it", async () => {
    await createUpload(folder, ID, "a");
    await writeFile(join(folder, "2026-11-25 13.50 Saved.mp4"), "x");
    expect(await listUploadIds(folder)).toEqual([ID]);
    await removeUpload((await readUpload(folder, ID))!);
    expect(await listUploadIds(folder)).toEqual([]);
  });

  test("a missing folder holds no recordings", async () => {
    expect(await listUploadIds(join(folder, "missing"))).toEqual([]);
  });

  test("an unreadable cursor is that recording's problem, not the read's", async () => {
    await createUpload(folder, ID, "a");
    await writeFile(join(folder, `.${ID}.partial.json`), "");
    const upload = await readUpload(folder, ID);
    expect(upload?.cursor).toBeNull();
    expect(upload?.cursorProblem).toContain("not JSON");
  });

  test("a save's claim refuses a second save while its process lives", async () => {
    await createUpload(folder, ID, "a");
    // The parent of this test: a live process that is not this one.
    await writeFile(join(folder, `.${ID}.finishing`), String(process.ppid));
    const claimed = await readUpload(folder, ID);
    expect(claimed?.finishingBy).toBe(process.ppid);
    expect(await claimFinish(claimed!)).toBe(false);
  });

  test("a claim whose process died is taken over; a released one can be claimed again", async () => {
    await createUpload(folder, ID, "a");
    // Pid 2^22 + 1 is above macOS's and Linux's default pid_max: never live.
    await writeFile(join(folder, `.${ID}.finishing`), String(4_194_305));
    const stale = await readUpload(folder, ID);
    expect(stale?.finishingBy).toBeNull();
    expect(await claimFinish(stale!)).toBe(true);
    expect((await readUpload(folder, ID))?.finishingBy).toBe(process.pid);
    await releaseFinish(stale!);
    expect((await readUpload(folder, ID))?.finishingBy).toBeNull();
  });
});
