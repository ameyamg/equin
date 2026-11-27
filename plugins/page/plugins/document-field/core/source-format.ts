import {
  coalesce,
  MARK_ORDER,
  runsEqual,
  scanInlineMarkdown,
  serializeInlineMarkdown,
  sortMarks,
  splitRuns,
  type ColorToken,
  type Mark,
  type RichText,
  type TextRun,
} from "@plugins/page/plugins/editor/core";
import type { DocumentDialect } from "./dialect";
import { sourceLines, type SourceLine } from "./source";

/** A range of the document's text, `start <= end`. */
export interface SourceRange {
  start: number;
  end: number;
}

/** One format change, as the toolbar and the shortcuts ask for it. */
export type SourceFormat =
  | { kind: "mark"; mark: Mark }
  | { kind: "color"; color: ColorToken }
  | { kind: "link"; href: string | null };

/** What the text in a range carries — the format toolbar's snapshot. */
export interface SourceFormatState {
  active: Record<Mark, boolean>;
  link: string | null;
  color: ColorToken | null;
}

/** The part of one `text` line a range covers, in its runs' offsets. */
interface LinePiece {
  line: SourceLine;
  runs: RichText;
  /** `[from, to)` in the line's runs, non-empty. */
  from: number;
  to: number;
}

/** Runs offset of a source offset inside a line: content characters before it. */
function runsOffsetAt(line: SourceLine, at: number): number {
  const rel = at - line.contentStart;
  let n = 0;
  for (const src of line.scan!.sourceOf) if (src < rel) n++;
  return n;
}

function piecesOf(lines: SourceLine[], range: SourceRange): LinePiece[] {
  const pieces: LinePiece[] = [];
  for (const line of lines) {
    if (line.kind !== "text" || !line.scan) continue;
    if (line.end < range.start || line.start > range.end) continue;
    const from = runsOffsetAt(line, Math.max(range.start, line.contentStart));
    const to = runsOffsetAt(line, Math.min(range.end, line.end));
    if (to > from) pieces.push({ line, runs: line.scan.runs, from, to });
  }
  return pieces;
}

/** The runs of `[from, to)` of `runs`. */
function middle(runs: RichText, from: number, to: number): RichText {
  return splitRuns(splitRuns(runs, to)[0], from)[1];
}

/** What the text in `range` carries. A collapsed or text-free range carries nothing. */
export function sourceFormatState(
  value: string,
  range: SourceRange,
  dialect: DocumentDialect,
): SourceFormatState {
  const covered = piecesOf(sourceLines(value, dialect), range).flatMap((p) =>
    middle(p.runs, p.from, p.to),
  );
  const active = {} as Record<Mark, boolean>;
  for (const mark of MARK_ORDER)
    active[mark] =
      covered.length > 0 &&
      covered.every((run) => run.marks?.includes(mark) ?? false);
  const uniform = <K extends "link" | "color">(key: K): TextRun[K] | null => {
    const first = covered[0]?.[key];
    return first !== undefined && covered.every((run) => run[key] === first)
      ? first
      : null;
  };
  return {
    active,
    link: uniform("link") ?? null,
    color: uniform("color") ?? null,
  };
}

function withFormat(run: TextRun, format: SourceFormat, on: boolean): TextRun {
  const next: TextRun = { ...run };
  if (format.kind === "mark") {
    const marks = new Set(run.marks ?? []);
    if (on) marks.add(format.mark);
    else marks.delete(format.mark);
    if (marks.size > 0) next.marks = sortMarks([...marks]);
    else delete next.marks;
  } else if (format.kind === "color") {
    if (format.color === "default") delete next.color;
    else next.color = format.color;
  } else if (format.href === null) delete next.link;
  else next.link = format.href;
  return next;
}

/**
 * Apply `format` to the text in `range`, in the dialect's own spelling: each
 * covered line's runs are re-formatted and the line's inline part re-written by
 * Pages' serializer (`**`, `_`, `~~`, `` ` ``, `<u>`, `<color value>`,
 * `[text](url)`). A mark is toggled ON unless it already covers every covered
 * character — the rich editor's rule. Prefixes, tag lines and code are
 * untouched.
 *
 * Returns the new text and the range of the same text in it (so a selection
 * stays on the words, inside their new delimiters). A range covering no text
 * returns the input unchanged.
 */
export function applySourceFormat(
  value: string,
  range: SourceRange,
  format: SourceFormat,
  dialect: DocumentDialect,
): { value: string; range: SourceRange } {
  const pieces = piecesOf(sourceLines(value, dialect), range);
  if (pieces.length === 0) return { value, range };
  const on =
    format.kind !== "mark" ||
    !pieces.every((p) =>
      middle(p.runs, p.from, p.to).every(
        (run) => run.marks?.includes(format.mark) ?? false,
      ),
    );
  let out = "";
  let at = 0;
  let start = range.start;
  let end = range.end;
  let shift = 0;
  pieces.forEach((piece, i) => {
    const [head, rest] = splitRuns(piece.runs, piece.from);
    const [mid, tail] = splitRuns(rest, piece.to - piece.from);
    const runs = coalesce([
      ...head,
      ...mid.map((run) => withFormat(run, format, on)),
      ...tail,
    ]);
    const inline = serializeInlineMarkdown(runs, [], dialect.softBreaks);
    // Compensates for: `serializeInlineMarkdown` does not always write text
    // that parses back to its runs (bolding `a *` in `a * b` writes
    // `**a \*** b`, all literal). Writing that would silently replace the
    // user's text with a different document.
    if (!runsEqual(scanInlineMarkdown(inline, []).runs, runs))
      throw new Error(
        `document-field: formatting would write ${JSON.stringify(inline)}, which does not read back as the text it formats`,
      );
    const { line } = piece;
    out += value.slice(at, line.contentStart) + inline;
    at = line.end;
    const sourceOf = scanInlineMarkdown(inline, []).sourceOf;
    const base = line.contentStart + shift;
    if (i === 0) start = base + (sourceOf[piece.from] ?? inline.length);
    if (i === pieces.length - 1)
      end = base + (piece.to > 0 ? sourceOf[piece.to - 1]! + 1 : 0);
    shift += inline.length - (line.end - line.contentStart);
  });
  out += value.slice(at);
  return { value: out, range: { start, end } };
}
