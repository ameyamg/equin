import { isSeededRowId } from "../collections";
import type { ConfigMergeRecord } from "./merge-record";

/**
 * What an automatic merge did with one top-level field of the document, read
 * off its record — the developer review's outcome column.
 *
 * - `took-new`: only the update changed it; the new default is taken.
 * - `kept-yours`: only the user changed it; their value is kept.
 * - `same-change`: both changed it the same way.
 * - `yours-won`: both changed it differently; the user's value is kept.
 * - `combined`: both changed it and the merge combined them below the field
 *   (list rows, object keys) — its `notes` say where the user's side won.
 * - `removed`: the update removed the field; the user's value is dropped.
 * - `renamed`: the update renamed the field (`retiredFields`); the user's
 *   value moved to the new key, listed as `carried`.
 * - `carried`: the new key of a renamed field, holding the value the user
 *   had set under the old one (`yours` is that value).
 */
export type MergeFieldOutcome =
  | "took-new"
  | "kept-yours"
  | "same-change"
  | "yours-won"
  | "combined"
  | "removed"
  | "renamed"
  | "carried";

/** A per-field review choice, as the record keeps it (`resolutions`). */
export type MergeFieldChoice =
  ConfigMergeRecord["resolutions"][number]["choice"];

/**
 * One field a merge touched: its value on every side (`undefined` = absent),
 * what the merge decided, the deeper choices it made inside the field, and the
 * latest review choice on it.
 */
export interface MergeReviewField {
  key: string;
  /** The default the user's override was written against. */
  base: unknown;
  /** The user's value before the merge (their override over `base`). */
  yours: unknown;
  /** The update's new default. */
  theirs: unknown;
  /** What the merge (and any review choice since) left in the override. */
  result: unknown;
  outcome: MergeFieldOutcome;
  /** Decisions inside this field, with their path below it (`[id:x].label`). */
  notes: { kind: ConfigMergeRecord["decisions"][number]["kind"]; at: string }[];
  resolution?: { choice: MergeFieldChoice; at: string };
}

/**
 * Drop the row ids `normalizeCollectionItems` seeds (`isSeededRowId`): an override
 * carries them and an origin does not, so a list nobody touched would read as
 * changed. Authored ids stay — they are what the rows are.
 */
export function withoutSeededIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSeededIds);
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === "id" && isSeededRowId(v)) continue;
    out[k] = withoutSeededIds(v);
  }
  return out;
}

/**
 * One spelling per value: object keys sorted, so a document a later save
 * rewrote in its schema's key order still reads as the same value.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
  );
}

const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(canonical(withoutSeededIds(a))) ===
  JSON.stringify(canonical(withoutSeededIds(b)));

/**
 * Every top-level field an automatic merge touched — one a side changed — in
 * document order (base, then the user's, then the update's new keys), each
 * with its outcome. A field nobody changed is not listed.
 *
 * Pure over the record: the review list and the registry's per-field actions
 * read the same values (`yours` is the user's override completed over `base`,
 * exactly what the merge read).
 */
export function mergeReviewFields(
  record: ConfigMergeRecord,
): MergeReviewField[] {
  const { base, theirs } = record.inputs;
  const yours = { ...base, ...record.inputs.yours };
  const keys = [
    ...new Set([
      ...Object.keys(base),
      ...Object.keys(yours),
      ...Object.keys(theirs),
    ]),
  ];
  const out: MergeReviewField[] = [];
  for (const key of keys) {
    const inField = record.decisions.filter((d) => d.path[0] === key);
    const removed = inField.some(
      (d) => d.kind === "removed-dropped" && d.path.length === 1,
    );
    const renamed = inField.some(
      (d) => d.kind === "removed-renamed" && d.path.length === 1,
    );
    // A renamed field's new key (or the field holding it, for a nested
    // `renamedTo`): the user's value is the one carried to it.
    const carriedHere = record.decisions.flatMap((d) =>
      d.kind === "removed-renamed" && d.to[0] === key ? [d] : [],
    );
    const carried = carriedHere.length > 0;
    const [b, t] = [base[key], theirs[key]];
    const y = carriedHere.reduce<unknown>(
      (value, d) => withValueAt(value, d.path, d.to, key, d.yours),
      yours[key],
    );
    let outcome: MergeFieldOutcome;
    if (removed) outcome = "removed";
    else if (renamed) outcome = "renamed";
    else if (carried) outcome = "carried";
    else if (same(y, b) && same(t, b)) continue;
    else if (same(y, b)) outcome = "took-new";
    else if (same(t, b)) outcome = "kept-yours";
    else if (same(y, t)) outcome = "same-change";
    else if (inField.some((d) => d.kind === "yours-won" && d.path.length === 1))
      outcome = "yours-won";
    else outcome = "combined";
    // The latest choice on the field wins.
    const resolution = [...record.resolutions]
      .reverse()
      .find((r) => r.path.length === 1 && r.path[0] === key);
    out.push({
      key,
      base: b,
      yours: y,
      theirs: t,
      result: record.result[key],
      outcome,
      notes: inField
        .filter((d) => d.path.length > 1)
        .map((d) => ({ kind: d.kind, at: d.path.slice(1).join(".") })),
      ...(resolution
        ? { resolution: { choice: resolution.choice, at: resolution.at } }
        : {}),
    });
  }
  return out;
}

/**
 * `value` (the user's pre-merge value of top-level field `key`) with a rename
 * applied: the carried value set at `to` below `key`, and the old key removed
 * when it sat under `key` too — what "yours" means for a field a rename
 * carried a value into, so Use mine writes the carried value back.
 */
function withValueAt(
  value: unknown,
  from: readonly string[],
  to: readonly string[],
  key: string,
  carried: unknown,
): unknown {
  if (to.length === 1) return carried;
  const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  const root: Record<string, unknown> = isObj(value)
    ? structuredClone(value)
    : {};
  if (from.length > 1 && from[0] === key) {
    let at: unknown = root;
    for (const k of from.slice(1, -1)) at = isObj(at) ? at[k] : undefined;
    if (isObj(at)) delete at[from.at(-1)!];
  }
  let at = root;
  for (const k of to.slice(1, -1)) {
    const next = at[k];
    at = isObj(next) ? next : (at[k] = {});
  }
  at[to.at(-1)!] = carried;
  return root;
}

/** Whether two values of a field are the same, seeded row ids and key order aside. */
export function sameFieldValue(a: unknown, b: unknown): boolean {
  return same(a, b);
}
