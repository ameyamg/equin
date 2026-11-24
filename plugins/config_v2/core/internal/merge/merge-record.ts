import { z } from "zod";
import {
  wholeList,
  wholeRecord,
} from "@plugins/packages/plugins/list-bound/core";
import { computeHash, type ConfigFileContent } from "../config-proxy";
import type { JsonValue } from "../types";
import type { FieldDecision, ListPlacement } from "./deep-merge";

/**
 * Which merge engine wrote a record: `mergeConfigDocument`'s deep merge
 * (phase 1 of `research/2026-11-24-global-config-auto-merge.md`). A later
 * engine names itself, so a record says what decided it.
 */
export const MERGE_ENGINE = "deep-v2";

const documentSchema = wholeRecord(z.unknown(), {
  reason: "one config document's fields — its descriptor's declared schema",
});

const mergePathSchema = wholeList(z.string(), {
  reason: "one merge path — as deep as the document it points into",
});

/** One stored file, exactly as the merge found it — what Undo writes back. */
const storedFileSchema = z.object({
  content: z.unknown(),
  hash: z.string().nullable(),
});

const fieldDecisionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("yours-won"),
    path: mergePathSchema,
    base: z.unknown().optional(),
    yours: z.unknown().optional(),
    theirs: z.unknown().optional(),
  }),
  z.object({
    kind: z.literal("removed-dropped"),
    path: mergePathSchema,
    yours: z.unknown(),
    reason: z.string().optional(),
  }),
  z.object({
    kind: z.literal("removed-renamed"),
    path: mergePathSchema,
    to: mergePathSchema,
    yours: z.unknown(),
  }),
]);

const rowKeysSchema = wholeList(z.string(), {
  reason: "the row keys of one config list — its rows",
});

/** A list the merge placed the update's new rows in (`ListPlacement`). */
const listPlacementSchema = z.object({
  path: mergePathSchema,
  order: rowKeysSchema,
  movable: rowKeysSchema,
});
const placementListsSchema = wholeList(listPlacementSchema, {
  reason: "the lists of one config document holding new rows — its fields",
});

/**
 * What the placement job decided for one list:
 *
 * - `moved`: the model's order was accepted and written (`order`).
 * - `same`: the model kept the merge's order.
 * - `rejected`: the answer was no permutation that keeps your rows' order
 *   (`reason`; `answer`, when it was a list of strings) — the merge's order
 *   stands.
 * - `edited`: the list was changed since the merge; nothing was written.
 */
const placementResultSchema = z.object({
  path: mergePathSchema,
  verdict: z.enum(["moved", "same", "rejected", "edited"]),
  order: rowKeysSchema.optional(),
  answer: rowKeysSchema.optional(),
  reason: z.string().optional(),
});

/**
 * Why the placement job asked nothing (or nothing usable) and the merge's
 * order stands: no Claude account on this computer, the account at its usage
 * limit, the call failed, or the record moved on (undone, superseded, every
 * placed list edited since).
 */
export const PLACEMENT_SKIP_REASONS = [
  "no-claude-account",
  "usage-limit",
  "failed",
  "undone",
  "superseded",
  "edited",
] as const;
export type PlacementSkipReason = (typeof PLACEMENT_SKIP_REASONS)[number];

/**
 * The placement job's state on a record. `not-needed`: the merge placed no
 * new row among the user's. `pending`: it did (`lists`), and the job has not
 * decided yet. `decided`: the model answered (`model`), each list's result in
 * `results`. `skipped`: nothing was asked or the answer was unusable
 * (`reason`, `detail`) — the merge's order stands.
 */
const placementSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not-needed") }),
  z.object({ status: z.literal("pending"), lists: placementListsSchema }),
  z.object({
    status: z.literal("decided"),
    lists: placementListsSchema,
    decidedAt: z.string(),
    model: z.string(),
    results: wholeList(placementResultSchema, {
      reason: "one per placed list of one config document",
    }),
  }),
  z.object({
    status: z.literal("skipped"),
    lists: placementListsSchema,
    decidedAt: z.string(),
    reason: z.enum(PLACEMENT_SKIP_REASONS),
    detail: z.string().optional(),
  }),
]);
export type MergePlacement = z.infer<typeof placementSchema>;
export type MergePlacementResult = z.infer<typeof placementResultSchema>;

/**
 * The record of one automatic merge — `<name>.merge.jsonc` beside the
 * document (`ConfigDocumentFile` `"merge"`), one per document, a later merge
 * replacing it. Its `// @hash` header is `toHash`.
 *
 * - `inputs`: the three documents the merge read (base = the ancestor, yours
 *   = the stale override, theirs = the new origin), and `result`, what it wrote.
 * - `undo`: the pre-merge override and ancestor (content and hash). Undo
 *   writes them back, which makes the document a normal conflict again, and
 *   stamps `undoneAt`: the record stays as a tombstone, so the next boot does
 *   not merge the same update again (it would, the conflict being exactly its
 *   input). Refused once the origin moved past `toHash` (superseded) or the
 *   override no longer holds `result` (edited since).
 * - `decisions`: what the merge chose on the user's behalf worth showing them.
 * - `placement`: the placement job's state (`MergePlacement`) — the lists
 *   where the merge placed rows the update added, and what the job decided.
 * - `resolutions`: the developer review's per-field choices (Keep / Use mine /
 *   Use new default), in the order they were made; `result` already holds
 *   what a Use mine / Use new default wrote.
 * - `acknowledgedAt`: the user dismissed it. `notifiedAt`: the update
 *   notification has announced it (announced once).
 */
export const configMergeRecordSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  mergedAt: z.string(),
  engine: z.string(),
  fromHash: z.string(),
  toHash: z.string(),
  inputs: z.object({
    base: documentSchema,
    yours: documentSchema,
    theirs: documentSchema,
  }),
  result: documentSchema,
  undo: z.object({
    override: storedFileSchema,
    ancestor: storedFileSchema,
  }),
  decisions: wholeList(fieldDecisionSchema, {
    reason: "the notable choices of one document's merge — its fields",
  }),
  placement: placementSchema,
  resolutions: wholeList(
    z.object({
      path: mergePathSchema,
      // keep: the merge's decision reviewed and kept; mine / new-default:
      // the field rewritten to the user's pre-merge value / the new default.
      choice: z.enum(["keep", "mine", "new-default"]),
      at: z.string(),
    }),
    { reason: "per-field resolutions of one document's merge — its fields" },
  ),
  acknowledgedAt: z.string().optional(),
  notifiedAt: z.string().optional(),
  undoneAt: z.string().optional(),
});
export type ConfigMergeRecord = z.infer<typeof configMergeRecordSchema>;

/** Parse a stored record, naming where it came from when it is not one. */
export function parseMergeRecord(
  content: JsonValue,
  where: string,
): ConfigMergeRecord {
  const parsed = configMergeRecordSchema.safeParse(content);
  if (!parsed.success) {
    throw new Error(
      `[config-v2] ${where} is not a config merge record: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

/** The record of a merge that just decided everything, ready to be written. */
export function buildMergeRecord(input: {
  id: string;
  now: Date;
  fromHash: string;
  toHash: string;
  base: JsonValue;
  yours: JsonValue;
  theirs: JsonValue;
  result: Record<string, JsonValue>;
  decisions: readonly FieldDecision[];
  placements: readonly ListPlacement[];
  undo: {
    override: { content: JsonValue; hash: string | null };
    ancestor: { content: JsonValue; hash: string | null };
  };
}): ConfigMergeRecord {
  const asDoc = (v: JsonValue): Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v) ? v : {};
  return {
    version: 1,
    id: input.id,
    mergedAt: input.now.toISOString(),
    engine: MERGE_ENGINE,
    fromHash: input.fromHash,
    toHash: input.toHash,
    inputs: {
      base: asDoc(input.base),
      yours: asDoc(input.yours),
      theirs: asDoc(input.theirs),
    },
    result: input.result,
    undo: input.undo,
    decisions: input.decisions.map((d) =>
      d.kind === "removed-renamed"
        ? { ...d, path: [...d.path], to: [...d.to] }
        : { ...d, path: [...d.path] },
    ),
    placement:
      input.placements.length === 0
        ? { status: "not-needed" }
        : {
            status: "pending",
            lists: input.placements.map((l) => ({
              path: [...l.path],
              order: [...l.order],
              movable: [...l.movable],
            })),
          },
    resolutions: [],
  };
}

/**
 * Where a record stands against the document as it is now:
 *
 * - `undone` — the user undid it: a tombstone (see `undo`).
 * - `current` — the origin is still the one it merged onto and the override
 *   still holds what it wrote: Undo puts the pre-merge state back.
 * - `superseded` — the origin moved past `toHash` (a later update): the record
 *   describes a state that no longer exists, and Undo is refused.
 * - `edited` — the user changed the document since (or removed it): Undo
 *   would throw their change away, so it is refused.
 */
export type MergeRecordStatus = "current" | "superseded" | "edited" | "undone";

export function mergeRecordStatus(
  record: ConfigMergeRecord,
  origin: ConfigFileContent | null,
  override: ConfigFileContent | null,
): MergeRecordStatus {
  if (record.undoneAt !== undefined) return "undone";
  if (origin === null || computeHash(origin.content) !== record.toHash)
    return "superseded";
  if (
    override === null ||
    override.hash !== record.toHash ||
    JSON.stringify(override.content) !== JSON.stringify(record.result)
  )
    return "edited";
  return "current";
}
