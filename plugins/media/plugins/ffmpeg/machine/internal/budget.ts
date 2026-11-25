/**
 * The bitrate plan of a re-encode that must fit `budgetBytes`: pure, so the
 * arithmetic is tested without ffmpeg.
 */

/** Share of the budget the streams may take; the rest is container overhead and rate-control drift. */
export const BUDGET_FILL = 0.95;

/** Below this a video is not watchable at any common size: refused, never encoded. */
export const MIN_VIDEO_KBPS = 300;

/** The AAC bitrate kept for a video with sound. */
export const AUDIO_KBPS = 128;

export type BudgetPlan =
  | { kind: "encode"; videoKbps: number; audioKbps: number }
  | {
      kind: "too-long";
      /** What the video stream would get — under {@link MIN_VIDEO_KBPS}. */
      videoKbps: number;
      minVideoKbps: number;
    };

/**
 * `budget·8·BUDGET_FILL / duration − audio`, in kbps (1000 bits/s, ffmpeg's
 * `k`), rounded down. A video whose stream would get less than
 * {@link MIN_VIDEO_KBPS} is `too-long`.
 */
export function planBudget(input: {
  budgetBytes: number;
  durationMs: number;
  hasAudio: boolean;
}): BudgetPlan {
  if (!(input.durationMs > 0)) {
    throw new Error(
      `a video's duration must be positive, got ${input.durationMs} ms`,
    );
  }
  const totalKbps =
    (input.budgetBytes * 8 * BUDGET_FILL) / (input.durationMs / 1000) / 1000;
  const audioKbps = input.hasAudio ? AUDIO_KBPS : 0;
  const videoKbps = Math.floor(totalKbps - audioKbps);
  if (videoKbps < MIN_VIDEO_KBPS) {
    return { kind: "too-long", videoKbps, minVideoKbps: MIN_VIDEO_KBPS };
  }
  return { kind: "encode", videoKbps, audioKbps };
}
