import { mkdtemp, rm } from "node:fs/promises";
import { stat } from "@plugins/packages/plugins/timed-fs/core";
import { basename, extname, join } from "node:path";
import { z } from "zod";
import { spawnExpectOk } from "@plugins/infra/plugins/spawn/core";
import { resolveFfmpeg, type FfmpegPaths } from "../../deps";
import { planBudget } from "./budget";

/** What `transcodeToBudget` answers; a failing ffprobe / ffmpeg throws instead. */
export type TranscodeResult =
  /** Re-encoded and checked: `size ≤ budgetBytes`. */
  | {
      kind: "fits";
      path: string;
      size: number;
      videoKbps: number;
      durationMs: number;
    }
  /** The video stream would get less than `minVideoKbps`: nothing encoded. */
  | {
      kind: "too-long";
      durationMs: number;
      videoKbps: number;
      minVideoKbps: number;
    }
  /** Encoded at the planned rate, and still over the budget (the file is removed). */
  | { kind: "over-budget"; size: number; budgetBytes: number };

const ProbeSchema = z.object({
  format: z.object({ duration: z.coerce.number() }),
  streams: z.array(z.object({ codec_type: z.string() })),
});

/**
 * Re-encode the video at `inputPath` to an MP4 (H.264 + AAC, two-pass at the
 * bitrate {@link planBudget} gives, `+faststart` so it streams) of at most
 * `budgetBytes`, written into `outDir` (the caller's, which it removes).
 * Probes the duration and whether there is sound with ffprobe first, and
 * checks the result's size after.
 *
 * Bounded by `signal` (a job's): an abort kills ffmpeg and throws its reason.
 * Runs at background priority — an encode takes every core it can get.
 */
export async function transcodeToBudget(
  inputPath: string,
  budgetBytes: number,
  opts: { signal: AbortSignal; outDir: string; ffmpeg?: FfmpegPaths },
): Promise<TranscodeResult> {
  const { signal, outDir } = opts;
  const ff = opts.ffmpeg ?? (await resolveFfmpeg());

  const probed = await spawnExpectOk(
    [
      ff.ffprobe,
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type",
      "-of",
      "json",
      inputPath,
    ],
    { signal },
  );
  const probe = ProbeSchema.parse(JSON.parse(probed.stdout));
  const durationMs = Math.round(probe.format.duration * 1000);
  const hasAudio = probe.streams.some((s) => s.codec_type === "audio");

  const plan = planBudget({ budgetBytes, durationMs, hasAudio });
  if (plan.kind === "too-long") return { ...plan, durationMs };

  const name = basename(inputPath, extname(inputPath));
  const outPath = join(outDir, `${name}.${budgetBytes}.mp4`);
  // The two passes share a rate log; it lives in a directory of its own.
  const logDir = await mkdtemp(join(outDir, ".transcode-"));
  const passLog = join(logDir, "pass");
  const video = [
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-b:v",
    `${plan.videoKbps}k`,
    "-pix_fmt",
    "yuv420p",
    "-passlogfile",
    passLog,
  ];
  const common = ["-y", "-hide_banner", "-loglevel", "error", "-i", inputPath];
  try {
    await spawnExpectOk(
      [ff.ffmpeg, ...common, ...video, "-pass", "1", "-an", "-f", "null", "-"],
      { signal, tier: "background", cwd: logDir },
    );
    await spawnExpectOk(
      [
        ff.ffmpeg,
        ...common,
        ...video,
        "-pass",
        "2",
        ...(plan.audioKbps > 0
          ? ["-c:a", "aac", "-b:a", `${plan.audioKbps}k`]
          : ["-an"]),
        "-movflags",
        "+faststart",
        outPath,
      ],
      { signal, tier: "background", cwd: logDir },
    );
  } finally {
    await rm(logDir, { recursive: true, force: true });
  }

  const { size } = await stat(outPath);
  if (size > budgetBytes) {
    await rm(outPath);
    return { kind: "over-budget", size, budgetBytes };
  }
  return {
    kind: "fits",
    path: outPath,
    size,
    videoKbps: plan.videoKbps,
    durationMs,
  };
}
