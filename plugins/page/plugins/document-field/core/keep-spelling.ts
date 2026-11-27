import type { SerializedBlock } from "@plugins/page/plugins/editor/core";
import {
  parseDocument,
  serializeDocument,
  type DocumentDialect,
} from "./dialect";

// The text is the person's: a rich edit rewrites only the lines it touched.
//
// The serializer writes ONE spelling of a forest (`* ` bullets, `*x*`
// emphasis…), and the dialect reads many (`- `, `_x_`…). Writing the whole
// forest on every rich keystroke would respell every line the person wrote
// in markdown, untouched ones too. So a rich read is the canonical spelling
// of the new forest, line by line, except where a line is unchanged from the
// canonical spelling of the text it was read from: there, the text's own line.

/** Above this many changed-line pairs the middle is written canonically (no line matching): spelling only, never content. */
const MATCH_BUDGET = 250_000;

/** What `previous` reads as, line for line (`null`: its lines don't map one-to-one onto the canonical ones). */
interface Basis {
  previous: string;
  dialect: DocumentDialect;
  /** The canonical line each of `previous`'s lines stands for. */
  canonical: string[];
  source: string[];
}

let memo: Basis | null = null;

function basisOf(previous: string, dialect: DocumentDialect): Basis | null {
  if (memo && memo.previous === previous && memo.dialect === dialect)
    return memo;
  // Blank lines before and after are dropped by the parse (`emptyBlocks:
  // "blank-line"`): they stand for nothing.
  const source = previous
    .replace(/^(\s*\n)+/, "")
    .replace(/(\n\s*)+$/, "")
    .split("\n");
  const canonical = serializeDocument(
    parseDocument(previous, dialect),
    dialect,
  ).split("\n");
  if (source.length !== canonical.length) return null;
  memo = { previous, dialect, canonical, source };
  return memo;
}

/** Index pairs (a, b) of a longest common subsequence of two line lists. */
function matchLines(
  a: readonly string[],
  b: readonly string[],
): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      table[i]![j] =
        a[i] === b[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

/**
 * `forest` written as a document's text, keeping `previous`'s own spelling on
 * every line the change from `previous` did not touch. The answer always reads
 * back as `forest` (checked): where kept spelling would read otherwise — a
 * line whose meaning hangs on its neighbours — the canonical spelling is
 * written instead.
 */
export function serializeDocumentKeeping(
  forest: SerializedBlock[],
  previous: string,
  dialect: DocumentDialect,
): string {
  const canonicalText = serializeDocument(forest, dialect);
  const basis = basisOf(previous, dialect);
  if (basis === null) return canonicalText;
  const next = canonicalText.split("\n");
  const prev = basis.canonical;
  // Most edits touch one line: match the common ends first, lines between.
  let head = 0;
  while (head < prev.length && head < next.length && prev[head] === next[head])
    head++;
  let tail = 0;
  while (
    tail < prev.length - head &&
    tail < next.length - head &&
    prev[prev.length - 1 - tail] === next[next.length - 1 - tail]
  )
    tail++;
  const out = next.slice();
  for (let k = 0; k < head; k++) out[k] = basis.source[k]!;
  for (let k = 1; k <= tail; k++)
    out[next.length - k] = basis.source[prev.length - k]!;
  const prevMid = prev.slice(head, prev.length - tail);
  const nextMid = next.slice(head, next.length - tail);
  if (prevMid.length * nextMid.length <= MATCH_BUDGET) {
    for (const [i, j] of matchLines(prevMid, nextMid))
      out[head + j] = basis.source[head + i]!;
  }
  const kept = out.join("\n");
  if (kept === canonicalText) return kept;
  return serializeDocument(parseDocument(kept, dialect), dialect) ===
    canonicalText
    ? kept
    : canonicalText;
}
