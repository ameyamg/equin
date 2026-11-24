import type { FieldsRecord } from "@plugins/fields/core";
import type { JsonValue } from "../types";
import { rowKey, type ListPlacement, type MergePath } from "./deep-merge";
import type { ConfigMergeRecord } from "./merge-record";
import { withoutSeededIds } from "./merge-review";

// The placement job's half that needs no I/O: where a placed list sits in a
// document, what the model is asked, and whether its answer may stand.
//
// The model only re-places rows: its answer is a list of row keys, accepted
// only as a permutation of the merge's order that moves nothing but the rows
// the update added (`ListPlacement.movable`) — the user's rows keep their
// relative order. Content is never the model's. Measured on the history
// replay: given the whole document, Sonnet placed new rows better 34 times,
// but undid user deletions, dropped added rows and brought back removed ones
// in 18 cases the deterministic merge got right
// (`research/2026-11-24-global-config-auto-merge.md`).

type Doc = { [key: string]: JsonValue };

function isDoc(v: unknown): v is Doc {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * A row's key as the merge paired it: `rowKey` with the `auto-<hash>` ids
 * `normalizeCollectionItems` seeds left out (the merge compared rows without
 * them, while a written document carries them).
 */
export function placementRowKey(row: JsonValue): string | null {
  return rowKey(withoutSeededIds(row) as JsonValue);
}

/** `[id:x]` → `id:x`; null for an object key. */
function rowSegment(segment: string): string | null {
  return segment.startsWith("[") && segment.endsWith("]")
    ? segment.slice(1, -1)
    : null;
}

/**
 * The value at a merge path — object keys, and `[<row key>]` for a list row —
 * or undefined when the document holds nothing there.
 */
export function valueAtMergePath(
  doc: JsonValue | undefined,
  path: MergePath,
): JsonValue | undefined {
  let at: JsonValue | undefined = doc;
  for (const segment of path) {
    const key = rowSegment(segment);
    if (key !== null) {
      if (!Array.isArray(at)) return undefined;
      at = at.find((row) => placementRowKey(row) === key);
    } else {
      if (!isDoc(at)) return undefined;
      at = at[segment];
    }
  }
  return at;
}

/**
 * `doc` with the list at `path` in `order` (row keys), copy-on-write. Throws
 * when there is no list there or its rows are not exactly `order`'s — the
 * caller checked the list is the one the merge wrote.
 */
export function withListOrder(
  doc: Doc,
  path: MergePath,
  order: readonly string[],
): Doc {
  const set = (at: JsonValue | undefined, i: number): JsonValue => {
    if (i === path.length) {
      if (!Array.isArray(at))
        throw new Error(`[config-v2] no list at ${path.join(".")}`);
      const byKey = new Map(at.map((row) => [placementRowKey(row), row]));
      if (byKey.size !== order.length || order.some((k) => !byKey.has(k)))
        throw new Error(
          `[config-v2] the list at ${path.join(".")} does not hold the rows ${JSON.stringify(order)}`,
        );
      return order.map((k) => byKey.get(k)!);
    }
    const segment = path[i]!;
    const key = rowSegment(segment);
    if (key !== null) {
      if (!Array.isArray(at))
        throw new Error(`[config-v2] no list at ${path.slice(0, i).join(".")}`);
      return at.map((row) =>
        placementRowKey(row) === key ? set(row, i + 1) : row,
      );
    }
    if (!isDoc(at))
      throw new Error(`[config-v2] no object at ${path.slice(0, i).join(".")}`);
    return { ...at, [segment]: set(at[segment], i + 1) };
  };
  return set(doc, 0) as Doc;
}

export type PlacementCheck =
  | { readonly ok: true; readonly order: string[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Whether `answer` may replace the merge's order of `list`: a list of row
 * keys that is a permutation of `list.order` (every row once, nothing else)
 * and keeps every row the update did not add in its relative order. Anything
 * else is refused with the reason; the merge's order then stands.
 */
export function checkPlacement(
  list: ListPlacement,
  answer: unknown,
): PlacementCheck {
  if (!Array.isArray(answer) || answer.some((k) => typeof k !== "string"))
    return { ok: false, reason: "not a list of row keys" };
  const keys = answer as string[];
  const expected = new Set(list.order);
  const seen = new Set<string>();
  for (const k of keys) {
    if (!expected.has(k)) return { ok: false, reason: `unknown row ${k}` };
    if (seen.has(k)) return { ok: false, reason: `row ${k} twice` };
    seen.add(k);
  }
  const missing = list.order.filter((k) => !seen.has(k));
  if (missing.length > 0)
    return { ok: false, reason: `dropped ${missing.join(", ")}` };
  const movable = new Set(list.movable);
  const fixed = (order: readonly string[]) =>
    order.filter((k) => !movable.has(k));
  if (JSON.stringify(fixed(keys)) !== JSON.stringify(fixed(list.order)))
    return { ok: false, reason: "reordered your rows" };
  return { ok: true, order: keys };
}

/** One placed list's rows on each side, by key, for the prompt. */
function rowsAt(doc: JsonValue | undefined, path: MergePath) {
  const list = valueAtMergePath(doc, path);
  if (!Array.isArray(list)) return [];
  return list.map((row) => ({
    key: placementRowKey(row),
    row: withoutSeededIds(row),
  }));
}

export const PLACEMENT_SYSTEM = `You place new items in a user's settings list after an app update.
The user had customized a list (YOURS, written against the old defaults BASE). The update shipped new defaults (NEW) that add items. A merge already decided which items the list holds and put each new item after its neighbour; you only decide WHERE the new items go.
Put each new item where the user would most plausibly want it, given how they arranged their list (grouping, order, what sits near what) and where the update put it.
Rules: answer with every key of MERGED exactly once; only the keys listed as "new" may move; every other key keeps its relative order. Never add, drop or rename a key.
Answer with ONLY a JSON array with one entry per list, in the order given, each entry the list's keys in your order. No prose, no code fence.`;

/**
 * The prompt asking for the placement of every list of a record: per list,
 * the field it belongs to (label and description), its rows on each side
 * (keys and content), the merge's order and which keys are new.
 */
export function placementPrompt(
  record: ConfigMergeRecord,
  lists: readonly ListPlacement[],
  fields: FieldsRecord,
): string {
  const { base, theirs } = record.inputs;
  const yours = { ...base, ...record.inputs.yours } as JsonValue;
  const show = (v: unknown) => JSON.stringify(v);
  return lists
    .map((list, i) => {
      const meta = fields[list.path[0]!]?.meta;
      const doc = [meta?.label, meta?.description].filter(Boolean).join(" — ");
      const side = (name: string, doc: JsonValue | undefined) =>
        `${name}:\n${rowsAt(doc, list.path)
          .map((r) => `  ${r.key} ${show(r.row)}`)
          .join("\n")}`;
      return [
        `LIST ${i + 1}: ${list.path.join(".")}${doc ? ` (${doc})` : ""}`,
        side("BASE", base as JsonValue),
        side("YOURS", yours),
        side("NEW", theirs as JsonValue),
        `MERGED (the merge's order): ${show(list.order)}`,
        `New keys you may move: ${show(list.movable)}`,
      ].join("\n");
    })
    .join("\n\n");
}

/**
 * The model's answer as one entry per list: `undefined` for a list it gave
 * nothing for, else what it answered (checked per list by the registry,
 * `checkPlacement`). A single list answered as a bare array of keys is that
 * list's answer. Null when the text is not a JSON array.
 */
export function parsePlacementAnswer(
  text: string,
  listCount: number,
): unknown[] | null {
  const body = text
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    if (err instanceof SyntaxError) return null;
    throw err;
  }
  if (!Array.isArray(parsed)) return null;
  // One list answered as its keys alone, without the outer array.
  if (
    listCount === 1 &&
    parsed.length > 0 &&
    parsed.every((k) => typeof k === "string")
  )
    return [parsed];
  return Array.from({ length: listCount }, (_, i) => parsed[i]);
}
