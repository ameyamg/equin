import type { FieldsRecord } from "@plugins/fields/core";
import {
  isSeededRowId,
  mapConfigLists,
  normalizeCollectionItems,
} from "../collections";
import type { ConfigV2ValidationIssue } from "../resource";
import type { ConfigDescriptor, JsonValue } from "../types";
import {
  deepMerge,
  type FieldDecision,
  type ListPlacement,
  type MergeConflictReason,
} from "./deep-merge";
import {
  sameFieldValue,
  withoutSeededIds as withoutAnySeededIds,
} from "./merge-review";

type Doc = Record<string, JsonValue>;

export type ConfigMergeResult =
  | {
      readonly status: "merged";
      /** The user's document against the new origin, ready to be written. */
      readonly document: Doc;
      readonly decisions: FieldDecision[];
      /** Lists where rows the update added were placed among the user's (`ListPlacement`). */
      readonly placements: ListPlacement[];
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
    if (!rows.some((r) => isSeededRowId(r.id))) return;
    return rows.map((row) => {
      if (!isSeededRowId(row.id)) return row;
      const { id: _seeded, ...rest } = row;
      return rest;
    });
  }) as Doc;
}

function isDoc(v: unknown): v is Doc {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function getAt(doc: Doc, path: readonly string[]): JsonValue | undefined {
  let at: JsonValue | undefined = doc;
  for (const key of path) {
    if (!isDoc(at)) return undefined;
    at = at[key];
  }
  return at;
}

/** Whether `path` can be set in `doc`: nothing but objects (or nothing) on the way. */
function canSetAt(doc: Doc, path: readonly string[]): boolean {
  let at: JsonValue | undefined = doc;
  for (const key of path.slice(0, -1)) {
    if (at === undefined) return true;
    if (!isDoc(at)) return false;
    at = at[key];
  }
  return at === undefined || isDoc(at);
}

/** Set `path` in `doc`, creating the objects on the way ({@link canSetAt} first). */
function setAt(doc: Doc, path: readonly string[], value: JsonValue): void {
  let at: Doc = doc;
  for (const key of path.slice(0, -1)) {
    const next: JsonValue | undefined = at[key];
    if (isDoc(next)) at = next;
    else at = at[key] = {};
  }
  at[path.at(-1)!] = value;
}

function deleteAt(doc: Doc, path: readonly string[]): void {
  const parent = getAt(doc, path.slice(0, -1));
  if (isDoc(parent)) delete parent[path.at(-1)!];
}

/**
 * Apply a descriptor's `retiredFields` to the merge's inputs, in place: each
 * retired key leaves `base` and `yours`, and a value the user changed under it
 * is carried to its `renamedTo` (on both `yours` and `base`, base taking the
 * new origin's value, so the carried value reads as the user's own change) or
 * reported dropped. Returns what it decided.
 */
function retireDeclaredFields(
  retired: NonNullable<ConfigDescriptor["retiredFields"]>,
  sides: { base: Doc; yours: Doc; theirs: Doc },
): FieldDecision[] {
  const { base, yours, theirs } = sides;
  const decisions: FieldDecision[] = [];
  for (const [dotted, decl] of Object.entries(retired)) {
    const path = dotted.split(".");
    // A retired key is no longer a field, so `withoutSeededIds` (which walks
    // the declared fields) left its list rows' seeded ids in place: compare
    // without them, or a list the user never touched reads as changed.
    const raw = getAt(yours, path);
    const mine =
      raw === undefined ? undefined : (withoutAnySeededIds(raw) as JsonValue);
    const changed =
      mine !== undefined && !sameFieldValue(mine, getAt(base, path));
    deleteAt(yours, path);
    deleteAt(base, path);
    if (!changed) continue;
    if (decl.renamedTo !== undefined) {
      const to = decl.renamedTo.split(".");
      const target = getAt(yours, to);
      // The user already set the new key themselves: theirs stands.
      const untouched =
        target === undefined || sameFieldValue(target, getAt(base, to));
      if (untouched && canSetAt(yours, to) && canSetAt(base, to)) {
        const theirsTo = getAt(theirs, to);
        setAt(yours, to, mine);
        if (theirsTo === undefined) deleteAt(base, to);
        else setAt(base, to, theirsTo);
        decisions.push({ kind: "removed-renamed", path, to, yours: mine });
        continue;
      }
    }
    decisions.push({
      kind: "removed-dropped",
      path,
      yours: mine,
      reason: decl.reason,
    });
  }
  return decisions;
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
 * - **Retired fields** (`descriptor.retiredFields`, dotted key paths). A value
 *   the user changed under a renamed key is carried to its new key
 *   (`removed-renamed`) — unless they also set the new key, whose value then
 *   stands and the old one is dropped; under a removed key it is dropped
 *   with the declared reason (`removed-dropped`).
 * - **Removed fields.** Any other top-level key the user changed that neither
 *   the descriptor nor the new origin has any more is dropped and listed
 *   (`removed-dropped`).
 * - **The rest** is {@link deepMerge}.
 * - **Schema gate.** The merged document must pass `descriptor.schema`, or the
 *   result is a conflict carrying the `issues`.
 *
 * Pure; the caller writes `document` only on `status: "merged"`.
 */
export function mergeConfigDocument(input: {
  descriptor: Pick<ConfigDescriptor, "fields" | "schema" | "retiredFields">;
  base: JsonValue;
  yours: JsonValue;
  theirs: JsonValue;
}): ConfigMergeResult {
  const { fields, schema } = input.descriptor;
  // Deep copies: retired and removed fields are moved and deleted in them
  // below, at any depth, and the caller's documents (a store's cached
  // content) must not change under it.
  const base = structuredClone(
    withoutSeededIds(asDocument(input.base, "base"), fields),
  );
  const theirs = withoutSeededIds(
    asDocument(input.theirs, "new origin"),
    fields,
  );
  const yours = structuredClone(
    withoutSeededIds(
      { ...base, ...asDocument(input.yours, "override") },
      fields,
    ),
  );

  const removed: FieldDecision[] = retireDeclaredFields(
    input.descriptor.retiredFields ?? {},
    { base, yours, theirs },
  );
  for (const key of Object.keys(yours)) {
    if (key in fields || key in theirs) continue;
    if (!sameFieldValue(yours[key], base[key])) {
      removed.push({
        kind: "removed-dropped",
        path: [key],
        yours: withoutAnySeededIds(yours[key]) as JsonValue,
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
  return {
    status: "merged",
    document,
    decisions,
    placements: outcome.placements,
  };
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
