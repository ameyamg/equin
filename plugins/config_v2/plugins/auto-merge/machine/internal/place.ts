import { z } from "zod";
import {
  parsePlacementAnswer,
  PLACEMENT_SYSTEM,
  placementPrompt,
  type MergePlacement,
} from "@plugins/config_v2/core";
import {
  getDescriptorByStorePath,
  readAutoMerge,
  settleAutoMergePlacementByPath,
  type PlacementSettlement,
} from "@plugins/config_v2/server";
import {
  ClaudeCliError,
  ClaudeUsageLimitError,
  runClaudePrint,
} from "@plugins/infra/plugins/claude-cli/server";
import {
  checkLaunchReadiness,
  type LaunchReadiness,
} from "@plugins/infra/plugins/claude-cli/plugins/availability/server";
import { defineJob } from "@plugins/infra/plugins/jobs/server";
import { systemOrigin } from "@plugins/infra/plugins/request-origin/core";

const PLACE_WRITER = systemOrigin("config-v2.auto-merge.place");

/** The model asked, and recorded on the placement (`decided.model`). */
const PLACEMENT_TIER = "sonnet";

// The give-up point of one placement call: a prompt of a few lists' rows,
// answered with their keys.
const PLACEMENT_TIMEOUT_MS = 90_000;

export const placementTargetSchema = z.object({
  storePath: z.string(),
  scopeId: z.string().optional(),
  recordId: z.string(),
});
export type PlacementTarget = z.infer<typeof placementTargetSchema>;

/** What the placement reaches outside itself — swapped in tests. */
export interface PlacementDeps {
  read: typeof readAutoMerge;
  settle: typeof settleAutoMergePlacementByPath;
  descriptor: typeof getDescriptorByStorePath;
  /** Can a one-shot generation run on the active Claude account now? */
  readiness(): Promise<LaunchReadiness>;
  /** One model call; throws `ClaudeCliError` (`ClaudeUsageLimitError` at a limit). */
  ask(input: {
    system: string;
    prompt: string;
    target: PlacementTarget;
  }): Promise<string>;
}

const claudeDeps: PlacementDeps = {
  read: readAutoMerge,
  settle: settleAutoMergePlacementByPath,
  descriptor: getDescriptorByStorePath,
  readiness: checkLaunchReadiness,
  ask: ({ system, prompt, target }) =>
    runClaudePrint({
      tier: PLACEMENT_TIER,
      system,
      prompt,
      timeoutMs: PLACEMENT_TIMEOUT_MS,
      source: {
        name: "config-v2.auto-merge.place",
        correlationId: target.recordId,
        context: {
          storePath: target.storePath,
          ...(target.scopeId ? { scopeId: target.scopeId } : {}),
        },
      },
    }),
};

/**
 * Re-place the rows an update added to the lists one automatic merge placed
 * them in (the record's `pending` placement): ask the model for an order of
 * row keys — never content — and hand its answer to the registry, which
 * writes only a permutation that keeps the user's rows in their order, on a
 * list nobody changed since (`settleAutoMergePlacementByPath`).
 *
 * Skips quietly — the merge's order stands, the record says why — with no
 * Claude account that can run (a clone nobody signed in on), at the
 * account's usage limit, on a failed call (claude-cli files it), or once the
 * record moved on (undone, superseded, every placed field edited since).
 * Returns the placement the record now holds, null when there was nothing to
 * settle.
 */
export async function placeAutoMerge(
  target: PlacementTarget,
  deps: PlacementDeps = claudeDeps,
): Promise<MergePlacement | null> {
  const { storePath, scopeId, recordId } = target;
  const settle = (settlement: PlacementSettlement) =>
    deps.settle(storePath, recordId, settlement, {
      writer: PLACE_WRITER,
      scopeId,
    });

  const state = await deps.read(storePath, scopeId);
  if (
    state === null ||
    state.record.id !== recordId ||
    state.record.placement.status !== "pending"
  )
    return null;
  const { record, status, editedFields } = state;
  const { lists } = state.record.placement;
  if (status === "undone" || status === "superseded")
    return settle({ kind: "skipped", reason: status });
  // The registry checks each list exactly; a placement whose every field was
  // edited since costs no call.
  if (lists.every((l) => editedFields.includes(l.path[0]!)))
    return settle({ kind: "skipped", reason: "edited" });

  const readiness = await deps.readiness();
  if (readiness.kind === "blocked")
    return settle({
      kind: "skipped",
      reason: "no-claude-account",
      detail: readiness.block.kind,
    });

  const descriptor = deps.descriptor(storePath);
  if (!descriptor)
    throw new Error(`[config-v2] no descriptor for "${storePath}"`);
  let text: string;
  try {
    text = await deps.ask({
      system: PLACEMENT_SYSTEM,
      prompt: placementPrompt(record, lists, descriptor.fields),
      target,
    });
  } catch (err) {
    // A limit is a state, not a fault: placement is a refinement the merge
    // already did without, so it is not held for the reset.
    if (err instanceof ClaudeUsageLimitError)
      return settle({ kind: "skipped", reason: "usage-limit" });
    // Any other failed call is filed by claude-cli in Claude Code's words.
    if (err instanceof ClaudeCliError)
      return settle({ kind: "skipped", reason: "failed", detail: err.message });
    throw err;
  }
  const answers = parsePlacementAnswer(text, lists.length);
  return settle({
    kind: "answered",
    model: PLACEMENT_TIER,
    // Not a JSON array: every list is refused, the text kept as its answer.
    answers: answers ?? lists.map(() => text),
  });
}

/**
 * The placement of one merge record, as a job: enqueued for every record
 * whose placement is pending (`autoMergePlaceWarmup`), keyed on the record so
 * a re-enqueue coalesces. One call; nothing retried — a placement that could
 * not be made leaves the merge's order, which was already written.
 */
export const autoMergePlaceJob = defineJob({
  name: "config-auto-merge.place",
  description:
    "Places the items an update added to your customized lists where you would put them (a model picks the order only; your items keep theirs).",
  // seconds: one Sonnet call bounded by its own timeout.
  hold: "seconds",
  input: placementTargetSchema,
  event: z.never(),
  dedup: { key: ({ recordId }) => recordId },
  maxAttempts: 1,
  run: async ({ input }) => {
    const placement = await placeAutoMerge(input);
    if (placement !== null)
      console.info(
        `[config-v2] placement of "${input.storePath}"${input.scopeId ? ` (${input.scopeId})` : ""}: ${placement.status === "decided" ? placement.results.map((r) => r.verdict).join(", ") : placement.status === "skipped" ? `skipped (${placement.reason})` : placement.status}`,
      );
  },
});
