import { z } from "zod";
import { defineConfig } from "@plugins/config_v2/core";
import { intField } from "@plugins/fields/plugins/int/plugins/config/core";

// The context nudge: once an agent's context passes `firstAt` tokens, and
// again at every `every` tokens past it, the agent is told how full its
// context is and asked to compact (`compact_context`) once the step it is on
// ends — so a compaction lands between two steps, not in the middle of one
// the way Claude's automatic compaction does. Read by the backend at every
// agent start (`AgentLaunchOptions.contextNudge`); the agent applies it in its
// own PostToolUse hook (bin/agent.ts).

export const contextNudgeConfig = defineConfig({
  name: "runtime-sdk-context-nudge",
  fields: {
    firstAt: intField({
      default: 500_000,
      min: 1,
      label: "First compaction nudge at (tokens)",
      description:
        "When an agent's context passes this many tokens, it is asked to compact its context once it finishes the step it is on. Applies from each agent's next start.",
    }),
    every: intField({
      default: 100_000,
      min: 1,
      label: "Then a nudge every (tokens)",
      description:
        "After the first nudge, the agent is reminded each time its context grows by this many more tokens. Applies from each agent's next start.",
    }),
  },
});

export const ContextNudgeThresholdsSchema = z.object({
  firstAt: z.number().int().positive(),
  every: z.number().int().positive(),
});
export type ContextNudgeThresholds = z.infer<
  typeof ContextNudgeThresholdsSchema
>;

/** The highest threshold crossed: -1 below `firstAt`, then 0, 1, … per `every`. */
export function nudgeBucket(tokens: number, t: ContextNudgeThresholds): number {
  if (tokens < t.firstAt) return -1;
  return Math.floor((tokens - t.firstAt) / t.every);
}

/**
 * Whether a reading of `tokens` owes a nudge, given the bucket last nudged
 * (-1: none). A reading above it nudges once, however many thresholds it
 * jumped; a reading below it (a compaction) lowers it silently, so the
 * sequence starts over.
 */
export function nextNudge(
  lastBucket: number,
  tokens: number,
  t: ContextNudgeThresholds,
): { lastBucket: number; nudge: boolean } {
  const bucket = nudgeBucket(tokens, t);
  return { lastBucket: bucket, nudge: bucket > lastBucket };
}

function formatTokens(n: number): string {
  if (n >= 1_000_000 && n % 1_000_000 === 0) return `${String(n / 1_000_000)}M`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  return `${String(Math.round(n / 1000))}k`;
}

/** The nudge's text. `window`: the context window, null while unmeasured. */
export function contextNudgeText(
  tokens: number,
  window: number | null,
): string {
  const size =
    window === null
      ? `${formatTokens(tokens)} tokens`
      : `${formatTokens(tokens)} / ${formatTokens(window)} tokens`;
  return [
    `Your context is ${size}.`,
    "When you finish the step you are on — the current part of the larger task (e.g. after implementing and before testing, or between two parts of the implementation), never in the middle of an edit — call `compact_context` with what to keep and the next step, so the compaction happens at a clean break.",
    "Do not stop the current step early for this.",
  ].join(" ");
}

const AssistantUsageSchema = z.object({
  message: z.object({
    usage: z.object({
      input_tokens: z.number(),
      cache_creation_input_tokens: z.number().nullish(),
      cache_read_input_tokens: z.number().nullish(),
    }),
  }),
});

/**
 * The context size a main-thread assistant message was answered at: its
 * request's input tokens, cached or not — fresh at every API call, where the
 * agent's `getContextUsage` measure moves only when a turn ends. Null for any
 * other message (a subagent's, a tool result, a system line); a main-thread
 * assistant message whose usage does not parse throws (ZodError) — the CLI
 * changed its shape, and the nudge must not go quiet unsaid.
 */
export function mainThreadContextTokens(msg: {
  type: string;
  parent_tool_use_id?: string | null;
}): number | null {
  if (msg.type !== "assistant" || msg.parent_tool_use_id !== null) return null;
  const u = AssistantUsageSchema.parse(msg).message.usage;
  return (
    u.input_tokens +
    (u.cache_creation_input_tokens ?? 0) +
    (u.cache_read_input_tokens ?? 0)
  );
}
