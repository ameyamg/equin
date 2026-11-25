import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveFreePair } from "./save-pair";

const BASE = "2026-11-25 13.05 Plan";
let folder: string;
let video: string;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "save-pair-"));
  video = join(folder, ".remuxed.mp4");
  await writeFile(video, "video");
});
afterEach(async () => {
  await rm(folder, { recursive: true });
});

async function saved(): Promise<string[]> {
  return (await readdir(folder)).filter((f) => !f.startsWith(".")).sort();
}

describe("saveFreePair", () => {
  test("names the video and its pointer track from one stem", async () => {
    expect(await saveFreePair(video, "{}\n", folder, BASE)).toBe(`${BASE}.mp4`);
    expect(await saved()).toEqual([`${BASE}.mp4`, `${BASE}.pointer.json`]);
  });

  test("a second recording in the same minute takes the next stem", async () => {
    await saveFreePair(video, "{}\n", folder, BASE);
    expect(await saveFreePair(video, "{}\n", folder, BASE)).toBe(
      `${BASE} (2).mp4`,
    );
  });

  test("a leftover pointer track without its video takes the stem", async () => {
    await writeFile(join(folder, `${BASE}.pointer.json`), "old\n");
    expect(await saveFreePair(video, "new\n", folder, BASE)).toBe(
      `${BASE} (2).mp4`,
    );
    expect(await saved()).toEqual([
      `${BASE} (2).mp4`,
      `${BASE} (2).pointer.json`,
      `${BASE}.pointer.json`,
    ]);
    // Neither track was overwritten nor attached to the wrong video.
    expect(await readFile(join(folder, `${BASE}.pointer.json`), "utf8")).toBe(
      "old\n",
    );
    expect(
      await readFile(join(folder, `${BASE} (2).pointer.json`), "utf8"),
    ).toBe("new\n");
  });

  test("a leftover pointer track is not adopted by a video without one", async () => {
    await writeFile(join(folder, `${BASE}.pointer.json`), "old\n");
    expect(await saveFreePair(video, null, folder, BASE)).toBe(
      `${BASE} (2).mp4`,
    );
  });

  test("a video without its pointer track still takes the stem", async () => {
    await writeFile(join(folder, `${BASE}.mp4`), "old");
    expect(await saveFreePair(video, "{}\n", folder, BASE)).toBe(
      `${BASE} (2).mp4`,
    );
    // The claimed-then-released pointer name is not left behind.
    expect(await saved()).toEqual([
      `${BASE} (2).mp4`,
      `${BASE} (2).pointer.json`,
      `${BASE}.mp4`,
    ]);
  });
});
