import { describe, expect, test } from "bun:test";
import type { JsonValue } from "../types";
import { deepMerge } from "./deep-merge";
import { readFileSync } from "node:fs";

/**
 * The history replay: every committed override in `config/**` history that was
 * restamped onto a new origin while both sides had changed (327 cases, taken
 * from `git log -- config/`), with the resolution its author committed.
 *
 * `yours` is already completed by its base (`base ⊕ override`), so the cases run
 * through the value-level merge; the document-level steps (completion, seeded
 * ids, removed fields, schema gate) are `merge-document.test.ts`'s.
 */
interface CorpusCase {
  commit: string;
  path: string;
  base: JsonValue;
  yours: JsonValue;
  theirs: JsonValue;
  resolved: JsonValue;
}

// Read, not imported: a JSON import of half a megabyte is a type tsc infers.
const cases = JSON.parse(
  readFileSync(new URL("./merge-corpus.json", import.meta.url), "utf8"),
) as CorpusCase[];

type Obj = { [key: string]: JsonValue };
const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const json = (v: unknown) => JSON.stringify(v);

function rowKey(row: JsonValue): string | null {
  if (typeof row === "string") return `s:${row}`;
  if (isObj(row)) {
    for (const k of ["id", "item", "label"]) {
      if (typeof row[k] === "string") return `${k}:${row[k]}`;
    }
  }
  return null;
}

const rowsOf = (v: JsonValue | undefined) =>
  new Map(
    (Array.isArray(v) ? v : []).flatMap((r) => {
      const k = rowKey(r);
      return k === null ? [] : [[k, r] as const];
    }),
  );

/** Every list in `merged` with two rows sharing a key. */
function duplicates(merged: JsonValue | undefined, path = ""): string[] {
  if (Array.isArray(merged)) {
    const keys = merged.map(rowKey).filter((k) => k !== null);
    const dup = keys.length !== new Set(keys).size ? [path] : [];
    return [
      ...dup,
      ...merged.flatMap((r, i) => duplicates(r, `${path}[${i}]`)),
    ];
  }
  if (isObj(merged)) {
    return Object.entries(merged).flatMap(([k, v]) =>
      duplicates(v, `${path}.${k}`),
    );
  }
  return [];
}

/** Rows a side deleted (present in base, absent from yours or theirs) that came back. */
function resurrected(
  base: JsonValue | undefined,
  yours: JsonValue | undefined,
  theirs: JsonValue | undefined,
  merged: JsonValue | undefined,
  path = "",
): string[] {
  if (Array.isArray(base) && Array.isArray(merged)) {
    const [B, Y, T, M] = [base, yours, theirs, merged].map(rowsOf) as Map<
      string,
      JsonValue
    >[];
    const out: string[] = [];
    for (const [k, row] of B!) {
      if ((!Y!.has(k) || !T!.has(k)) && M!.has(k)) out.push(`${path}[${k}]`);
      else if (M!.has(k))
        out.push(
          ...resurrected(row, Y!.get(k), T!.get(k), M!.get(k), `${path}[${k}]`),
        );
    }
    return out;
  }
  if (isObj(base) && isObj(merged)) {
    return Object.keys(base).flatMap((k) =>
      resurrected(
        base[k],
        isObj(yours) ? yours[k] : undefined,
        isObj(theirs) ? theirs[k] : undefined,
        merged[k],
        `${path}.${k}`,
      ),
    );
  }
  return [];
}

/** Same content as `b`, list order ignored. */
const canon = (v: JsonValue): JsonValue =>
  Array.isArray(v)
    ? v.map((x) => json(canon(x))).sort()
    : isObj(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canon(v[k]!)]),
        )
      : v;

describe("merge history corpus", () => {
  const results = cases.map((c) => ({
    c,
    outcome: deepMerge(c.base, c.yours, c.theirs),
  }));

  test("covers the whole replay", () => {
    expect(cases.length).toBe(327);
  });

  test("no case is left undecided", () => {
    const undecided = results
      .filter((r) => r.outcome.reasons.length > 0)
      .map((r) => `${r.c.commit} ${r.c.path}: ${json(r.outcome.reasons)}`);
    expect(undecided).toEqual([]);
  });

  test("no merged list holds two rows with the same key", () => {
    const dup = results.flatMap((r) =>
      duplicates(r.outcome.merged).map((p) => `${r.c.commit} ${r.c.path} ${p}`),
    );
    expect(dup).toEqual([]);
  });

  test("no row a side deleted comes back", () => {
    const back = results.flatMap((r) =>
      resurrected(r.c.base, r.c.yours, r.c.theirs, r.outcome.merged).map(
        (p) => `${r.c.commit} ${r.c.path} ${p}`,
      ),
    );
    expect(back).toEqual([]);
  });

  test("matches the committed resolution at least as often as when it was measured", () => {
    let exact = 0;
    let orderOnly = 0;
    for (const { c, outcome } of results) {
      if (json(outcome.merged) === json(c.resolved)) exact++;
      else if (json(canon(outcome.merged!)) === json(canon(c.resolved)))
        orderOnly++;
    }
    // Measured 2026-11-24: 151 exact, 145 same content in another order, 31
    // with different content (the author changed what they kept while restamping).
    expect(exact).toBeGreaterThanOrEqual(151);
    expect(exact + orderOnly).toBeGreaterThanOrEqual(296);
  });
});
