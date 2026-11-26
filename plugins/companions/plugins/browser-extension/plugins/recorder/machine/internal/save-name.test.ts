import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveFreeName } from "./save-name";

const BASE = "2026-11-25 13.05 Plan";
let folder: string;
let video: string;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "save-name-"));
  video = join(folder, ".remuxed.mp4");
  await writeFile(video, "video");
});
afterEach(async () => {
  await rm(folder, { recursive: true });
});

async function saved(): Promise<string[]> {
  return (await readdir(folder)).filter((f) => !f.startsWith(".")).sort();
}

describe("saveFreeName", () => {
  test("saves the video alone, under its base name", async () => {
    expect(await saveFreeName(video, folder, BASE)).toBe(`${BASE}.mp4`);
    expect(await saved()).toEqual([`${BASE}.mp4`]);
  });

  test("a taken name is never overwritten: the next one is used", async () => {
    await writeFile(join(folder, `${BASE}.mp4`), "old");
    expect(await saveFreeName(video, folder, BASE)).toBe(`${BASE} (2).mp4`);
    expect(await readFile(join(folder, `${BASE}.mp4`), "utf8")).toBe("old");
    expect(await saved()).toEqual([`${BASE} (2).mp4`, `${BASE}.mp4`]);
  });
});
