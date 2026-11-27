import {
  markdownParseTagNames,
  parseInlineMarkdown,
  parseMarkdownToForest,
  runsEqual,
  runsOf,
  scanInlineMarkdown,
  type ColorToken,
  type InlineScan,
  type Mark,
  type MarkdownContext,
} from "@plugins/page/plugins/editor/core";
import {
  documentBlockHandle,
  documentMarkdownContext,
  isDocumentBlockType,
  type DocumentDialect,
} from "./dialect";

/**
 * What one source line of a document is, read the way the dialect's parser
 * reads it.
 *
 * - `text` — a block's text: a prefix (indentation, a marker like `# ` / `* ` /
 *   `1. `, the escape before a marker-like word) and inline markdown after it.
 * - `blank` — an empty line.
 * - `syntax` — the whole line is syntax: a container tag (`<quote>`,
 *   `</quote>`), a self-closing tag (`<text/>`), a code fence, a void block
 *   (`---`).
 * - `code` — a line of a fenced code body: literal text, no inline syntax.
 */
export type SourceLineKind = "text" | "blank" | "syntax" | "code";

export interface SourceLine {
  kind: SourceLineKind;
  /** Offset of the line's first character in the document. */
  start: number;
  /** Offset just past its last character (its `\n` excluded). */
  end: number;
  /** Where its inline markdown starts — `text` lines; `start` for the others. */
  contentStart: number;
  /** The inline scan of `[contentStart, end)` — `text` lines only. */
  scan: InlineScan | null;
  /**
   * The LEAF block this line belongs to, as an index into the document's leaf
   * blocks in document order (a line, a code block, a divider — never a
   * container): what a selection is carried across the field's two modes by.
   * `null` for a line no block owns: a container's tag lines, a blank line the
   * parse drops (leading or trailing in its scope).
   */
  block: number | null;
}

/** One stretch of a `text` line with one look: syntax, or text with its marks. */
export interface SourceSegment {
  start: number;
  end: number;
  /** Syntax (a prefix, a delimiter, a tag, a link's url) rather than text. */
  syntax: boolean;
  marks: readonly Mark[];
  color?: ColorToken;
  link?: string;
}

interface LineShape {
  kind: "text" | "syntax";
  /** Prefix length within the line, `text` lines only. */
  prefix: number;
}

// The single-line parse is the expensive part of a read, and nearly every line
// of a document is unchanged between two keystrokes. Keyed by the dialect's
// context (one per dialect object) and the line's text.
const shapeMemo = new WeakMap<MarkdownContext, Map<string, LineShape>>();
const SHAPE_MEMO_CAP = 2000;
const contextMemo = new WeakMap<DocumentDialect, MarkdownContext>();

function contextOf(dialect: DocumentDialect): MarkdownContext {
  let ctx = contextMemo.get(dialect);
  if (!ctx) {
    ctx = documentMarkdownContext(dialect);
    contextMemo.set(dialect, ctx);
  }
  return ctx;
}

/**
 * The shape of one non-blank line outside a fence, by the parser itself: the
 * line is parsed alone, and its prefix is the shortest cut whose inline parse
 * yields exactly the block's text. So a marker, a `\` escaping a marker-like
 * word and any spelling a handle's own `parseLine` accepts are all found
 * without this module naming one.
 */
function lineShape(trimmed: string, ctx: MarkdownContext): LineShape {
  let memo = shapeMemo.get(ctx);
  if (!memo) {
    memo = new Map();
    shapeMemo.set(ctx, memo);
  }
  const hit = memo.get(trimmed);
  if (hit) return hit;
  const shape = computeLineShape(trimmed, ctx);
  if (memo.size >= SHAPE_MEMO_CAP) memo.clear();
  memo.set(trimmed, shape);
  return shape;
}

function computeLineShape(trimmed: string, ctx: MarkdownContext): LineShape {
  const [block] = parseMarkdownToForest(trimmed, ctx);
  if (!block || !isDocumentBlockType(block.type))
    return { kind: "syntax", prefix: 0 };
  if (!documentBlockHandle(block.type).acceptsText)
    return { kind: "syntax", prefix: 0 };
  const runs = runsOf((block.data as { text?: unknown } | undefined)?.text);
  for (let k = 0; k <= trimmed.length; k++) {
    if (runsEqual(parseInlineMarkdown(trimmed.slice(k), []), runs))
      return { kind: "text", prefix: k };
  }
  throw new Error(
    `document-field: no prefix of ${JSON.stringify(trimmed)} leaves the text its ${block.type} block parses to — the line's shape cannot be read`,
  );
}

interface TagNames {
  names: Set<string>;
  fences: { open: string; close: string }[];
}

const tagNamesMemo = new WeakMap<MarkdownContext, TagNames>();
function tagNamesOf(ctx: MarkdownContext): TagNames {
  let found = tagNamesMemo.get(ctx);
  if (!found) {
    found = {
      names: new Set(ctx.handles.flatMap(markdownParseTagNames)),
      fences: ctx.handles.flatMap((h) =>
        h.markdown?.fence ? [h.markdown.fence] : [],
      ),
    };
    tagNamesMemo.set(ctx, found);
  }
  return found;
}

type TagLine = "open" | "close" | "self" | null;
/** What a syntax line does to the block structure around it. */
type LineRole = TagLine | "fence-open" | "fence-close";

function tagLineOf(trimmed: string, names: Set<string>): TagLine {
  const m = /^<(\/?)([a-z][a-z0-9-]*)(?=[\s>/])/.exec(trimmed);
  if (!m || !names.has(m[2]!)) return null;
  if (m[1]) return "close";
  return /\/>\s*$/.test(trimmed) ? "self" : "open";
}

/**
 * The document's lines, each with its kind, its prefix and the leaf block it
 * belongs to — what the Markdown mode draws and edits by, and what a selection
 * is carried between the two modes by.
 */
export function sourceLines(
  value: string,
  dialect: DocumentDialect,
): SourceLine[] {
  const ctx = contextOf(dialect);
  const { names, fences } = tagNamesOf(ctx);
  const raw = value.split("\n");
  const lines: SourceLine[] = [];
  const roles: LineRole[] = [];
  let at = 0;
  let fence: { close: string } | null = null;
  for (const text of raw) {
    const start = at;
    const end = at + text.length;
    at = end + 1;
    const indent = /^\s*/.exec(text)![0].length;
    const trimmed = text.slice(indent);
    const base = { start, end, contentStart: start, scan: null, block: null };
    if (fence) {
      if (trimmed.trimEnd() === fence.close) {
        fence = null;
        lines.push({ ...base, kind: "syntax" });
        roles.push("fence-close");
      } else {
        lines.push({ ...base, kind: "code" });
        roles.push(null);
      }
      continue;
    }
    if (trimmed.trim() === "") {
      lines.push({ ...base, kind: "blank" });
      roles.push(null);
      continue;
    }
    const opened = fences.find((f) => trimmed.startsWith(f.open));
    if (opened) {
      fence = opened;
      lines.push({ ...base, kind: "syntax" });
      roles.push("fence-open");
      continue;
    }
    const tag = tagLineOf(trimmed, names);
    roles.push(tag);
    if (tag) {
      lines.push({ ...base, kind: "syntax" });
      continue;
    }
    const shape = lineShape(trimmed, ctx);
    if (shape.kind === "syntax") {
      lines.push({ ...base, kind: "syntax" });
      continue;
    }
    const contentStart = start + indent + shape.prefix;
    lines.push({
      ...base,
      kind: "text",
      contentStart,
      scan: scanInlineMarkdown(value.slice(contentStart, end), []),
    });
  }
  numberBlocks(lines, roles, dialect);
  return lines;
}

/**
 * Give each line its leaf block. A code fence's lines share one; a container's
 * tag lines own none; a blank line owns one only where the parse keeps it — in
 * the `"empty-block"` dialect, with a block before it and after it in its own
 * scope (a blank run first or last in the document or in a tag body is
 * dropped by the parser, which is the dialect's accepted loss) — and in the
 * `"every-empty-block"` dialect, always.
 */
function numberBlocks(
  lines: SourceLine[],
  roles: LineRole[],
  dialect: DocumentDialect,
): void {
  let next = 0;
  let inCode = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const role = roles[i];
    if (inCode) {
      line.block = next - 1;
      if (role === "fence-close") inCode = false;
      continue;
    }
    if (line.kind === "blank") {
      if (
        // An empty text is no line at all (the parse reads it as no block).
        (dialect.blankLines === "every-empty-block" && lines.length > 1) ||
        (dialect.blankLines === "empty-block" && blankIsKept(lines, roles, i))
      )
        line.block = next++;
      continue;
    }
    if (role === "open" || role === "close") continue;
    line.block = next++;
    if (role === "fence-open") inCode = true;
  }
}

function blankIsKept(
  lines: SourceLine[],
  roles: LineRole[],
  i: number,
): boolean {
  let before = i - 1;
  while (before >= 0 && lines[before]!.kind === "blank") before--;
  let after = i + 1;
  while (after < lines.length && lines[after]!.kind === "blank") after++;
  if (before < 0 || after >= lines.length) return false;
  if (roles[before] === "open") return false;
  if (roles[after] === "close") return false;
  return true;
}

/** The segments of a `text` line: its prefix, then each stretch of one look. */
export function lineSegments(line: SourceLine): SourceSegment[] {
  if (line.kind !== "text" || !line.scan) {
    return line.end > line.start
      ? [
          {
            start: line.start,
            end: line.end,
            syntax: line.kind !== "code",
            marks: [],
          },
        ]
      : [];
  }
  const out: SourceSegment[] = [];
  const push = (seg: SourceSegment) => {
    const last = out.at(-1);
    if (
      last &&
      last.end === seg.start &&
      last.syntax === seg.syntax &&
      last.color === seg.color &&
      last.link === seg.link &&
      last.marks.join() === seg.marks.join()
    ) {
      last.end = seg.end;
      return;
    }
    out.push(seg);
  };
  if (line.contentStart > line.start)
    push({
      start: line.start,
      end: line.contentStart,
      syntax: true,
      marks: [],
    });
  const { runs, sourceOf, syntax } = line.scan;
  // Content characters, each with its run's look.
  const looks = new Map<number, Omit<SourceSegment, "start" | "end">>();
  let k = 0;
  for (const run of runs) {
    const look = {
      syntax: false,
      marks: run.marks ?? [],
      ...(run.color ? { color: run.color } : {}),
      ...(run.link ? { link: run.link } : {}),
    };
    for (let c = 0; c < run.text.length; c++) looks.set(sourceOf[k++]!, look);
  }
  const len = line.end - line.contentStart;
  let s = 0;
  for (let i = 0; i < len; i++) {
    while (s < syntax.length && syntax[s]![1] <= i) s++;
    const inSyntax = s < syntax.length && syntax[s]![0] <= i;
    const look = inSyntax
      ? { syntax: true, marks: [] }
      : (looks.get(i) ?? { syntax: false, marks: [] });
    const abs = line.contentStart + i;
    push({ start: abs, end: abs + 1, ...look });
  }
  return out;
}
