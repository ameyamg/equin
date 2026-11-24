import { z } from "zod";
import {
  wholeList,
  wholeRecord,
} from "@plugins/packages/plugins/list-bound/core";
import { computeHash, type ConfigFileContent } from "../config-proxy";
import type { JsonValue } from "../types";
import type { FieldDecision } from "./deep-merge";

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
  }),
]);

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
 * - `placement` / `resolutions`: reserved for the placement job and the
 *   per-field Use mine / Use new default actions (later phases).
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
  placement: z.object({ status: z.enum(["not-needed", "pending"]) }),
  resolutions: wholeList(
    z.object({
      path: mergePathSchema,
      choice: z.enum(["mine", "new-default"]),
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
    decisions: input.decisions.map((d) => ({ ...d, path: [...d.path] })),
    placement: { status: "not-needed" },
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
