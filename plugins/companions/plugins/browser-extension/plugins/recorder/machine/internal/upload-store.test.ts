import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claimFinish,
  createUpload,
  listUploads,
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
    await writeCursor(folder, ID, {
      base: "2026-11-25 13.50 Plan",
      nextSeq: 3,
      lastSize: 10,
      bytes: 30,
    });
    const upload = await readUpload(folder, ID);
    expect(upload?.cursor).toEqual({
      base: "2026-11-25 13.50 Plan",
      nextSeq: 3,
      lastSize: 10,
      bytes: 30,
    });
    expect(upload?.bytes).toBe(30);
  });

  test("a partial from before cursors is listed with its own size and no cursor", async () => {
    await writeFile(partialPathOf(folder, ID), new Uint8Array(12));
    const upload = await readUpload(folder, ID);
    expect(upload?.cursor).toBeNull();
    expect(upload?.bytes).toBe(12);
    expect(upload?.base).toMatch(
      /^\d{4}-\d\d-\d\d \d\d\.\d\d Unfinished recording$/,
    );
  });

  test("an id that is not one create mints names no file", async () => {
    expect(await readUpload(folder, "../../etc/passwd")).toBeNull();
    expect(await readUpload(folder, ID)).toBeNull();
  });

  test("list finds every unfinished recording; remove drops it", async () => {
    await createUpload(folder, ID, "a");
    await writeFile(join(folder, "2026-11-25 13.50 Saved.mp4"), "x");
    const listed = await listUploads(folder);
    expect(listed.map((u) => u.id)).toEqual([ID]);
    await removeUpload(listed[0]!);
    expect(await listUploads(folder)).toEqual([]);
  });

  test("a missing folder holds no recordings", async () => {
    expect(await listUploads(join(folder, "missing"))).toEqual([]);
  });

  test("an unreadable cursor is that row's problem, not the folder's", async () => {
    await createUpload(folder, ID, "a");
    await writeFile(join(folder, `.${ID}.partial.json`), "");
    const [upload] = await listUploads(folder);
    expect(upload?.cursor).toBeNull();
    expect(upload?.cursorProblem).toContain("not JSON");
  });

  test("a finish's claim hides it and refuses a second finish while its process lives", async () => {
    await createUpload(folder, ID, "a");
    // The parent of this test: a live process that is not this one.
    await writeFile(join(folder, `.${ID}.finishing`), String(process.ppid));
    const claimed = await readUpload(folder, ID);
    expect(claimed?.finishingBy).toBe(process.ppid);
    expect(await claimFinish(claimed!)).toBe(false);
    expect(await listUploads(folder)).toEqual([]);
  });

  test("a claim whose process died is taken over; a released one is unfinished again", async () => {
    await createUpload(folder, ID, "a");
    // Pid 2^22 + 1 is above macOS's and Linux's default pid_max: never live.
    await writeFile(join(folder, `.${ID}.finishing`), String(4_194_305));
    const stale = await readUpload(folder, ID);
    expect(stale?.finishingBy).toBeNull();
    expect(await claimFinish(stale!)).toBe(true);
    expect((await readUpload(folder, ID))?.finishingBy).toBe(process.pid);
    await releaseFinish(stale!);
    expect((await listUploads(folder)).map((u) => u.id)).toEqual([ID]);
  });
});
