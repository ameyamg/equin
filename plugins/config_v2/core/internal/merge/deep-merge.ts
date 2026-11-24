import type { JsonValue } from "../types";

/**
 * Where in a document a merge outcome sits: object keys, and a list row as
 * `[<row key>]` (`[id:deps]`, `[item:x]`, `[label:y]`, `[s:literal]`) — never an
 * index, which means nothing once two sides reordered.
 */
export type MergePath = readonly string[];

/**
 * Why a merge could not be decided — the document stays a conflict.
 *
 * - `unkeyed-list`: both sides changed a list whose rows have no unique key
 *   (`id` > `item` > `label` > the string itself), so rows cannot be paired.
 * - `order`: both sides reordered the same (non-reorder-tree) list differently.
 * - `delete-modify`: the update removed something the user changed.
 */
export interface MergeConflictReason {
  readonly kind: "unkeyed-list" | "order" | "delete-modify";
  readonly path: MergePath;
}

/**
 * A choice the merge made on the user's behalf that is worth showing them.
 *
 * - `yours-won`: both sides changed the same value differently (or the user
 *   deleted what the update changed); the user's side is kept.
 * - `removed-dropped`: the user changed a field the current config no longer
 *   has; their value no longer applies and is dropped. `reason` is the
 *   descriptor's own (`retiredFields`), when it declared the removal.
 * - `removed-renamed`: the user changed a field the config renamed
 *   (`retiredFields[path].renamedTo`); their value is carried to `to`.
 */
export type FieldDecision =
  | {
      readonly kind: "yours-won";
      readonly path: MergePath;
      readonly base: JsonValue | undefined;
      readonly yours: JsonValue | undefined;
      readonly theirs: JsonValue | undefined;
    }
  | {
      readonly kind: "removed-dropped";
      readonly path: MergePath;
      readonly yours: JsonValue;
      readonly reason?: string;
    }
  | {
      readonly kind: "removed-renamed";
      readonly path: MergePath;
      readonly to: MergePath;
      readonly yours: JsonValue;
    };

/**
 * A list where the merge placed rows the update added into a list the user
 * changed — by the neighbour rule, which matched the committed placement in
 * only part of the history replay. The placement job may re-place exactly
 * these rows (`config_v2/plugins/auto-merge`).
 *
 * - `path`: the list, as a {@link MergePath}.
 * - `order`: the merge's order, as row keys (`id:x`, `item:y`, `s:z`).
 * - `movable`: the rows the update added (in `order`, absent from the user's
 *   side) — the only ones a re-placement may move; every other row keeps its
 *   relative order, which is the user's arrangement.
 */
export interface ListPlacement {
  readonly path: MergePath;
  readonly order: readonly string[];
  readonly movable: readonly string[];
}

export interface DeepMergeOutcome {
  /** `undefined` only when the merged root itself is absent. */
  readonly merged: JsonValue | undefined;
  readonly reasons: MergeConflictReason[];
  readonly decisions: FieldDecision[];
  /** Lists holding rows the update added among the user's changes. */
  readonly placements: ListPlacement[];
}

type Obj = { [key: string]: JsonValue };
type Absent = JsonValue | undefined;

const eq = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A row's identity, by precedence `id` > `item` > `label` > the string itself. */
export function rowKey(row: JsonValue): string | null {
  if (typeof row === "string") return `s:${row}`;
  if (isObj(row)) {
    if (typeof row.id === "string") return `id:${row.id}`;
    if (typeof row.item === "string") return `item:${row.item}`;
    if (typeof row.label === "string") return `label:${row.label}`;
  }
  return null;
}

/** The rows of a list by key, or null when a row has none or two share one. */
function keyedRows(list: JsonValue[]): Map<string, JsonValue> | null {
  const rows = new Map<string, JsonValue>();
  for (const row of list) {
    const key = rowKey(row);
    if (key === null || rows.has(key)) return null;
    rows.set(key, row);
  }
  return rows;
}

/**
 * Place `key` in `seq` right after its nearest preceding neighbour in
 * `sideOrder` (the order of the side that added it), else right before its
 * nearest following one, else at the end.
 */
function insertAfterNeighbour(
  seq: string[],
  key: string,
  sideOrder: string[],
): void {
  const at = sideOrder.indexOf(key);
  for (let j = at - 1; j >= 0; j--) {
    const i = seq.indexOf(sideOrder[j]!);
    if (i >= 0) {
      seq.splice(i + 1, 0, key);
      return;
    }
  }
  for (let j = at + 1; j < sideOrder.length; j++) {
    const i = seq.indexOf(sideOrder[j]!);
    if (i >= 0) {
      seq.splice(i, 0, key);
      return;
    }
  }
  seq.push(key);
}

/**
 * A reorder tree's rows (`.items`): the user's arrangement is the point of the
 * document, so their order wins over a reorder by the update.
 */
const USER_ORDER_WINS_KEY = "items";

/**
 * The three-way merge of two JSON values against their common base — THE
 * algorithm behind config's Merge, its conflict banner and auto-merge.
 *
 * - A value only one side changed takes that side.
 * - Objects merge per key.
 * - Lists whose rows all carry a unique key merge per row; a row only one
 *   side added is placed after its neighbour from that side; in a reorder
 *   tree's `items` the user's order wins, elsewhere both sides reordering
 *   differently is a conflict.
 * - Both sides changing the same scalar keeps the user's value (`yours-won`).
 *
 * Pure: nothing is mutated, `undefined` stands for an absent key.
 */
export function deepMerge(
  base: Absent,
  yours: Absent,
  theirs: Absent,
): DeepMergeOutcome {
  const sink: Sink = { reasons: [], decisions: [], placements: [] };
  const merged = mergeAt(base, yours, theirs, [], sink);
  return { merged, ...sink };
}

/** Where a merge collects what it could not decide, chose, and placed. */
interface Sink {
  reasons: MergeConflictReason[];
  decisions: FieldDecision[];
  placements: ListPlacement[];
}

function mergeAt(
  base: Absent,
  yours: Absent,
  theirs: Absent,
  path: string[],
  sink: Sink,
): Absent {
  const { reasons, decisions } = sink;
  if (eq(yours, base)) return theirs;
  if (eq(theirs, base) || eq(yours, theirs)) return yours;

  if (isObj(yours) && isObj(theirs) && (base === undefined || isObj(base))) {
    const b: Obj = base ?? {};
    const out: Obj = {};
    const keys = new Set([
      ...Object.keys(b),
      ...Object.keys(yours),
      ...Object.keys(theirs),
    ]);
    for (const key of keys) {
      const value = mergeAt(
        b[key],
        yours[key],
        theirs[key],
        [...path, key],
        sink,
      );
      if (value !== undefined) out[key] = value;
    }
    return out;
  }

  const listOrAbsent = (v: Absent) => v === undefined || Array.isArray(v);
  if (
    (Array.isArray(yours) || Array.isArray(theirs)) &&
    listOrAbsent(base) &&
    listOrAbsent(yours) &&
    listOrAbsent(theirs)
  ) {
    // A list one side created or removed whole is the empty list on that side.
    const B = keyedRows((base as JsonValue[] | undefined) ?? []);
    const Y = keyedRows((yours as JsonValue[] | undefined) ?? []);
    const T = keyedRows((theirs as JsonValue[] | undefined) ?? []);
    if (!B || !Y || !T) {
      reasons.push({ kind: "unkeyed-list", path });
      return yours;
    }
    return mergeRows(B, Y, T, path, sink);
  }

  if (theirs === undefined) {
    // The update removed what the user changed: keeping it may resurrect a
    // removed item, dropping it loses the user's edit.
    reasons.push({ kind: "delete-modify", path });
    return yours;
  }
  decisions.push({ kind: "yours-won", path, base, yours, theirs });
  return yours;
}

function mergeRows(
  B: Map<string, JsonValue>,
  Y: Map<string, JsonValue>,
  T: Map<string, JsonValue>,
  path: string[],
  sink: Sink,
): JsonValue[] {
  const { reasons } = sink;
  const rows = new Map<string, JsonValue>();
  for (const key of new Set([...B.keys(), ...Y.keys(), ...T.keys()])) {
    const value = mergeAt(
      B.get(key),
      Y.get(key),
      T.get(key),
      [...path, `[${key}]`],
      sink,
    );
    if (value !== undefined) rows.set(key, value);
  }

  // Order of the rows all three sides hold: did a side reorder them?
  const common = (side: Map<string, JsonValue>) =>
    [...side.keys()].filter((k) => B.has(k) && Y.has(k) && T.has(k));
  const yoursReordered = !eq(common(Y), common(B));
  const theirsReordered = !eq(common(T), common(B));
  if (
    yoursReordered &&
    theirsReordered &&
    !eq(common(Y), common(T)) &&
    path.at(-1) !== USER_ORDER_WINS_KEY
  ) {
    reasons.push({ kind: "order", path });
  }

  // The side whose order stands; the other side's additions are placed after
  // their neighbour in that side's order.
  const primary = yoursReordered ? [...Y.keys()] : [...T.keys()];
  const other = yoursReordered ? [...T.keys()] : [...Y.keys()];
  const seq = primary.filter((k) => rows.has(k));
  for (const k of other) {
    if (rows.has(k) && !seq.includes(k)) insertAfterNeighbour(seq, k, other);
  }
  for (const k of rows.keys()) if (!seq.includes(k)) seq.push(k);
  // Rows only the update added, placed among the user's: worth a second look.
  const movable = seq.filter((k) => !Y.has(k));
  if (movable.length > 0 && seq.length > 1)
    sink.placements.push({ path, order: seq, movable });
  return seq.map((k) => rows.get(k)!);
}
