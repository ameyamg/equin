import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { stat } from "@plugins/packages/plugins/timed-fs/core";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnExpectOk } from "@plugins/infra/plugins/spawn/core";
import { resolveFfmpeg, type FfmpegPaths } from "../../deps";
import { transcodeToBudget } from "./transcode";

let dir: string;
let ff: FfmpegPaths;
let clip: string;

// A 20 s 640×360 test pattern with a tone, encoded near-losslessly so it is
// far over the budgets below.
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "transcode-test-"));
  ff = await resolveFfmpeg();
  clip = join(dir, "clip.mp4");
  await spawnExpectOk(
    [
      ff.ffmpeg,
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=640x360:rate=30:duration=20",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=20",
      "-c:v",
      "libx264",
      "-crf",
      "4",
      "-c:a",
      "aac",
      "-shortest",
      clip,
    ],
    { timeoutMs: 120_000 },
  );
}, 180_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("transcodeToBudget", () => {
  test("lands under the budget, as a seekable H.264 MP4", async () => {
    const budget = 1024 * 1024; // 1 MiB over 20 s: ~270 kbps left for the picture, under 300
    const tooSmall = await transcodeToBudget(clip, budget, {
      signal: AbortSignal.timeout(120_000),
      outDir: dir,
      ffmpeg: ff,
    });
    expect(tooSmall.kind).toBe("too-long");

    const fitBudget = 2 * 1024 * 1024; // ~669 kbps for the picture
    const res = await transcodeToBudget(clip, fitBudget, {
      signal: AbortSignal.timeout(120_000),
      outDir: dir,
      ffmpeg: ff,
    });
    if (res.kind !== "fits")
      throw new Error(`expected fits, got ${JSON.stringify(res)}`);
    expect(res.size).toBeLessThanOrEqual(fitBudget);
    expect((await stat(res.path)).size).toBe(res.size);
    expect(res.durationMs).toBeGreaterThan(19_000);
    const probe = await spawnExpectOk(
      [
        ff.ffprobe,
        "-v",
        "error",
        "-show_entries",
        "stream=codec_name",
        "-of",
        "csv=p=0",
        res.path,
      ],
      { timeoutMs: 30_000 },
    );
    expect(probe.stdout.trim().split("\n").sort()).toEqual(["aac", "h264"]);
  }, 240_000);
});
