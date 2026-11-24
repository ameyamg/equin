import type { FieldsRecord } from "@plugins/fields/core";
import { mapConfigLists, normalizeCollectionItems } from "../collections";
import type { ConfigV2ValidationIssue } from "../resource";
import type { ConfigDescriptor, JsonValue } from "../types";
import {
  deepMerge,
  type FieldDecision,
  type MergeConflictReason,
} from "./deep-merge";

type Doc = Record<string, JsonValue>;

export type ConfigMergeResult =
  | {
      readonly status: "merged";
      /** The user's document against the new origin, ready to be written. */
      readonly document: Doc;
      readonly decisions: FieldDecision[];
    }
  | {
      readonly status: "conflict";
      /** The tentative merge — the user's side wherever it could not decide. Never written. */
      readonly document: Doc;
      readonly decisions: FieldDecision[];
      /** What the merge could not decide (empty when only the schema refused it). */
      readonly reasons: MergeConflictReason[];
      /** Why the merged document fails the descriptor's schema, when it does. */
      readonly issues?: ConfigV2ValidationIssue[];
    };

function asDocument(value: JsonValue, side: string): Doc {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      `[config-v2] merge: the ${side} document is not an object (${JSON.stringify(value)?.slice(0, 80)})`,
    );
  }
  return value;
}

/**
 * Drop the `auto-<hash>` ids `normalizeCollectionItems` seeds on id-less rows of
 * non-`stableIdentity` lists. A user override carries them (it was normalized on
 * write) while an origin does not, so without this every row of a list the user
 * never touched reads as one row deleted plus one added. Authored ids — and
 * every id of a `stableIdentity` list — stay: they are the rows' keys.
 */
function withoutSeededIds(doc: Doc, fields: FieldsRecord): Doc {
  return mapConfigLists(doc, fields, (rows, field) => {
    if (field.stableIdentity) return;
    if (!rows.some((r) => typeof r.id === "string" && r.id.startsWith("auto-")))
      return;
    return rows.map((row) => {
      if (typeof row.id !== "string" || !row.id.startsWith("auto-")) return row;
      const { id: _seeded, ...rest } = row;
      return rest;
    });
  }) as Doc;
}

/**
 * The three-way merge of a config document: the user's override (`yours`,
 * written against `base`, the origin it was stamped with) carried onto the new
 * origin (`theirs`) — THE merge the Settings Merge button, the conflict
 * banner's `trueConflictKeys` and auto-merge share.
 *
 * - **Completion first.** `yours` is `base ⊕ override`: a partial override
 *   (`{ "enabled": true }`) changed one key, it did not delete the rest. All
 *   three sides drop seeded row ids (`withoutSeededIds`) before comparing.
 * - **Removed fields.** A key the user changed that neither the descriptor nor
 *   the new origin has any more is dropped and listed (`removed-dropped`).
 * - **The rest** is {@link deepMerge}.
 * - **Schema gate.** The merged document must pass `descriptor.schema`, or the
 *   result is a conflict carrying the `issues`.
 *
 * Pure; the caller writes `document` only on `status: "merged"`.
 */
export function mergeConfigDocument(input: {
  descriptor: Pick<ConfigDescriptor, "fields" | "schema">;
  base: JsonValue;
  yours: JsonValue;
  theirs: JsonValue;
}): ConfigMergeResult {
  const { fields, schema } = input.descriptor;
  // Copied: removed fields are deleted from it below, and the caller's
  // document (a store's cached content) must not change under it.
  const base = { ...withoutSeededIds(asDocument(input.base, "base"), fields) };
  const theirs = withoutSeededIds(
    asDocument(input.theirs, "new origin"),
    fields,
  );
  const yours = withoutSeededIds(
    { ...base, ...asDocument(input.yours, "override") },
    fields,
  );

  const removed: FieldDecision[] = [];
  for (const key of Object.keys(yours)) {
    if (key in fields || key in theirs) continue;
    if (JSON.stringify(yours[key]) !== JSON.stringify(base[key])) {
      removed.push({
        kind: "removed-dropped",
        path: [key],
        yours: yours[key]!,
      });
    }
    delete yours[key];
    delete base[key];
  }

  const outcome = deepMerge(base, yours, theirs);
  const document = normalizeCollectionItems(
    asDocument(outcome.merged ?? {}, "merged"),
    fields,
  ) as Doc;
  const decisions = [...removed, ...outcome.decisions];

  if (outcome.reasons.length > 0) {
    return {
      status: "conflict",
      document,
      decisions,
      reasons: outcome.reasons,
    };
  }
  const parsed = schema.safeParse(document);
  if (!parsed.success) {
    return {
      status: "conflict",
      document,
      decisions,
      reasons: [],
      issues: parsed.error.issues.map((i) => ({
        path: i.path.map((k) => (typeof k === "symbol" ? String(k) : k)),
        message: i.message,
      })),
    };
  }
  return { status: "merged", document, decisions };
}

/**
 * The top-level fields a merge left undecided — the conflict banner's
 * `trueConflictKeys`. Empty for a merged document. A conflict that names no
 * field (a schema rule over the whole document) implicates every field: an
 * empty list would read as "merges cleanly" while Merge keeps refusing.
 */
export function mergeConflictFields(result: ConfigMergeResult): string[] {
  if (result.status === "merged") return [];
  const keys = new Set<string>();
  for (const r of result.reasons) {
    if (r.path[0] !== undefined) keys.add(r.path[0]);
  }
  for (const i of result.issues ?? []) {
    if (i.path[0] !== undefined) keys.add(String(i.path[0]));
  }
  return keys.size > 0 ? [...keys] : Object.keys(result.document);
}
