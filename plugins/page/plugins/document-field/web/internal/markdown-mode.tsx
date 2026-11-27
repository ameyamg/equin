import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $addUpdateTag,
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getEditor,
  $getRoot,
  $getSelection,
  $isLineBreakNode,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  HISTORY_MERGE_TAG,
  HISTORY_PUSH_TAG,
  LineBreakNode,
  ParagraphNode,
  TEXT_TYPE_TO_FORMAT,
  TextNode,
  type LexicalNode,
  type ElementNode,
  type PointType,
} from "lexical";
import { colorCssValue, type Mark } from "@plugins/page/plugins/editor/core";
import type { FormatSource } from "@plugins/page/plugins/editor/web";
import {
  applySourceFormat,
  blockPointOf,
  lineSegments,
  sourceFormatState,
  sourceLines,
  sourceOffsetOf,
  type BlockPoint,
  type DocumentDialect,
  type SourceFormat,
  type SourceSegment,
} from "../../core";
import { $offsetWithin, $pointWithin, $selectPoints } from "./lexical-offsets";

/**
 * Markdown mode holds the document's text as it is written: ONE paragraph of
 * text nodes and line breaks (Lexical's plain-text model), the text exactly the
 * document's value. What it shows is derived from that text on every change —
 * each stretch of a line re-cut into its own node by `sourceLines` /
 * `lineSegments` (the parser's own reading), text carrying its marks as format
 * bits and colour, syntax dimmed — so the source and the rich view can never
 * read the same characters two ways. The node cut is presentation only: the
 * value is the text, whatever the nodes.
 */

const SYNTAX_STYLE = "color: var(--muted-foreground)";
const LINK_STYLE = "color: var(--primary-text); text-decoration: underline";
const CODE_LINE_STYLE = "font-family: var(--font-mono)";

/** The paragraph holding the source (created when the root is empty). */
function $sourceParagraph(): ElementNode {
  const root = $getRoot();
  const first = root.getFirstChild();
  if ($isParagraphNode(first)) return first;
  const paragraph = $createParagraphNode();
  root.append(paragraph);
  return paragraph;
}

/** The document's value: the source paragraph's text. */
export function $sourceText(): string {
  const root = $getRoot();
  const first = root.getFirstChild();
  if (first === null) return "";
  if (!$isParagraphNode(first) || root.getChildrenSize() > 1)
    throw new Error(
      "document-field: the Markdown face holds one paragraph of source",
    );
  return first.getTextContent();
}

/** Replace the source with `value`, as plain text (the transform cuts it). */
export function $setSourceText(value: string): void {
  const paragraph = $sourceParagraph();
  paragraph.clear();
  value.split("\n").forEach((line, i) => {
    if (i > 0) paragraph.append($createLineBreakNode());
    if (line) paragraph.append($createTextNode(line));
  });
}

/** The selection as source offsets, or `null` when there is none. */
export function $sourceSelection(): { anchor: number; focus: number } | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  const first = $getRoot().getFirstChild();
  if (!$isParagraphNode(first)) return null;
  // The root holds only the source paragraph: a point on the root itself is
  // before (offset 0) or after it.
  const offset = (point: PointType) =>
    point.getNode().is($getRoot())
      ? point.offset === 0
        ? 0
        : first.getTextContentSize()
      : $offsetWithin(first, point);
  return { anchor: offset(selection.anchor), focus: offset(selection.focus) };
}

/** Select source offsets `[anchor, focus]`. */
export function $selectSource(anchor: number, focus: number): void {
  const paragraph = $sourceParagraph();
  $selectPoints(
    $pointWithin(paragraph, anchor),
    $pointWithin(paragraph, focus),
  );
}

interface Token {
  text: string | null; // null: a line break
  format: number;
  style: string;
}

function formatOf(marks: readonly Mark[]): number {
  let format = 0;
  for (const mark of marks) {
    const bit = TEXT_TYPE_TO_FORMAT[mark];
    if (bit === undefined)
      throw new Error(`document-field: no format bit for mark "${mark}"`);
    format |= bit;
  }
  return format;
}

function styleOf(seg: SourceSegment): string {
  if (seg.syntax) return SYNTAX_STYLE;
  const parts: string[] = [];
  const color = colorCssValue(seg.color);
  if (seg.link) parts.push(LINK_STYLE);
  else if (color) parts.push(`color: ${color}`);
  return parts.join("; ");
}

/** The nodes the source should be cut into. */
function tokensOf(value: string, dialect: DocumentDialect): Token[] {
  const out: Token[] = [];
  const push = (t: Token) => {
    const last = out.at(-1);
    if (
      last &&
      last.text !== null &&
      t.text !== null &&
      last.format === t.format &&
      last.style === t.style
    )
      last.text += t.text;
    else out.push(t);
  };
  sourceLines(value, dialect).forEach((line, i) => {
    if (i > 0) out.push({ text: null, format: 0, style: "" });
    if (line.kind === "code") {
      if (line.end > line.start)
        push({
          text: value.slice(line.start, line.end),
          format: 0,
          style: CODE_LINE_STYLE,
        });
      return;
    }
    for (const seg of lineSegments(line))
      push({
        text: value.slice(seg.start, seg.end),
        format: seg.syntax ? 0 : formatOf(seg.marks),
        style: styleOf(seg),
      });
  });
  return out;
}

function $cutMatches(paragraph: ElementNode, tokens: Token[]): boolean {
  const kids = paragraph.getChildren();
  if (kids.length !== tokens.length) return false;
  return kids.every((kid, i) => {
    const t = tokens[i]!;
    if (t.text === null) return $isLineBreakNode(kid);
    return (
      $isTextNode(kid) &&
      kid.getTextContent() === t.text &&
      kid.getFormat() === t.format &&
      kid.getStyle() === t.style
    );
  });
}

/** Re-cuts the source paragraph whenever its text changes. */
export function SourceCutPlugin({ dialect }: { dialect: DocumentDialect }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const off = editor.registerNodeTransform(ParagraphNode, (paragraph) => {
      // Mid-composition the IME owns the text node; cut once it commits.
      if ($getEditor().isComposing()) return;
      const value = paragraph.getTextContent();
      const tokens = tokensOf(value, dialect);
      if ($cutMatches(paragraph, tokens)) return;
      const selection = $getSelection();
      const at = $isRangeSelection(selection)
        ? {
            anchor: $offsetWithin(paragraph, selection.anchor),
            focus: $offsetWithin(paragraph, selection.focus),
          }
        : null;
      paragraph.clear();
      for (const t of tokens) {
        if (t.text === null) {
          paragraph.append($createLineBreakNode());
          continue;
        }
        const node = $createTextNode(t.text);
        node.setFormat(t.format);
        node.setStyle(t.style);
        paragraph.append(node);
      }
      if (at)
        $selectPoints(
          $pointWithin(paragraph, at.anchor),
          $pointWithin(paragraph, at.focus),
        );
    });
    // Lexical runs an element's transform only when the element itself is
    // dirty, and typing dirties only its text node: a leaf change re-cuts its
    // paragraph too.
    const markParent = (node: LexicalNode) => {
      // `markDirty`, not a dirtiness test: the parent already reads dirty
      // (unintentionally, through its child), which is exactly the state
      // Lexical skips element transforms in.
      node.getParent()?.markDirty();
    };
    const offText = editor.registerNodeTransform(TextNode, markParent);
    const offBreak = editor.registerNodeTransform(LineBreakNode, markParent);
    // The text the editor opened with (or held under another dialect) was
    // never cut: mark it, outside the history — a cut changes no text.
    editor.update(
      () => {
        $addUpdateTag(HISTORY_MERGE_TAG);
        $sourceParagraph().markDirty();
      },
      { discrete: true },
    );
    return () => {
      off();
      offText();
      offBreak();
    };
  }, [editor, dialect]);
  return null;
}

/**
 * The format source of Markdown mode: a mark, a colour or a link is written in
 * the dialect's own spelling around the selected text (`applySourceFormat`),
 * and the toolbar's state is read off the same parse. One undo entry per
 * format.
 */
export function markdownFormatSource(dialect: DocumentDialect): FormatSource {
  const $range = () => {
    const at = $sourceSelection();
    if (!at) return null;
    return {
      start: Math.min(at.anchor, at.focus),
      end: Math.max(at.anchor, at.focus),
    };
  };
  const $apply = (format: SourceFormat) => {
    const range = $range();
    if (!range) return;
    const value = $sourceText();
    const next = applySourceFormat(value, range, format, dialect);
    if (next.value === value) return;
    $addUpdateTag(HISTORY_PUSH_TAG);
    $setSourceText(next.value);
    $selectSource(next.range.start, next.range.end);
  };
  return {
    $read() {
      const range = $range();
      return range
        ? sourceFormatState($sourceText(), range, dialect)
        : sourceFormatState("", { start: 0, end: 0 }, dialect);
    },
    $toggleMark: (mark) => $apply({ kind: "mark", mark }),
    $setColor: (color) => $apply({ kind: "color", color }),
    $setLink: (href) => $apply({ kind: "link", href }),
    caretCue: false,
  };
}

/** The selection as block points (see `BlockPoint`), or `null`. */
export function $markdownBlockSelection(
  dialect: DocumentDialect,
): { anchor: BlockPoint; focus: BlockPoint } | null {
  const at = $sourceSelection();
  if (!at) return null;
  const lines = sourceLines($sourceText(), dialect);
  return {
    anchor: blockPointOf(lines, at.anchor),
    focus: blockPointOf(lines, at.focus),
  };
}

/** Select block points in the source. */
export function $selectMarkdownBlocks(
  sel: { anchor: BlockPoint; focus: BlockPoint },
  dialect: DocumentDialect,
): void {
  const lines = sourceLines($sourceText(), dialect);
  $selectSource(
    sourceOffsetOf(lines, sel.anchor),
    sourceOffsetOf(lines, sel.focus),
  );
}
