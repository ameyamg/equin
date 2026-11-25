import type { MachinePluginDefinition } from "@plugins/framework/plugins/server-core/core";

export { transcodeToBudget } from "./internal/transcode";
export type { TranscodeResult } from "./internal/transcode";
export {
  AUDIO_KBPS,
  BUDGET_FILL,
  MIN_VIDEO_KBPS,
  planBudget,
} from "./internal/budget";
export type { BudgetPlan } from "./internal/budget";

export default {
  description:
    "transcodeToBudget(input, budgetBytes, { signal, outDir }): re-encode a video to an MP4 of at most budgetBytes — ffprobe for duration and sound, two-pass H.264 at budget·8·0.95/duration − 128k AAC, +faststart, size checked after — answering fits | too-long (the picture would get < 300 kbps, nothing encoded) | over-budget.",
  contributions: [],
} satisfies MachinePluginDefinition;
