import {
  parseMarkdownToForest,
  serializeForestToMarkdown,
  type BlockHandle,
  type MarkdownContext,
  type SerializedBlock,
} from "@plugins/page/plugins/editor/core";
import { textBlock } from "@plugins/page/plugins/text/core";
import { heading1Block } from "@plugins/page/plugins/heading/plugins/heading-1/core";
import { heading2Block } from "@plugins/page/plugins/heading/plugins/heading-2/core";
import { heading3Block } from "@plugins/page/plugins/heading/plugins/heading-3/core";
import { bulletedListBlock } from "@plugins/page/plugins/bulleted-list/core";
import { numberedListBlock } from "@plugins/page/plugins/numbered-list/core";
import { quoteBlock } from "@plugins/page/plugins/quote/core";
import { codeBlock } from "@plugins/page/plugins/code-block/core";
import { dividerBlock } from "@plugins/page/plugins/divider/core";

/**
 * The block types a document field can hold — a CLOSED list, so plain data
 * rather than a slot: the field draws each one itself (a line, a quote box, a
 * code box, a rule), so a type it does not know how to draw cannot be in it.
 * Pages' own handles, so the field reads and writes Pages' text format.
 */
export const DOCUMENT_BLOCK_TYPES = [
  "text",
  "heading-1",
  "heading-2",
  "heading-3",
  "bulleted-list",
  "numbered-list",
  "quote",
  "code-block",
  "divider",
] as const;
export type DocumentBlockType = (typeof DOCUMENT_BLOCK_TYPES)[number];

const HANDLES: Record<DocumentBlockType, BlockHandle<unknown>> = {
  text: textBlock,
  "heading-1": heading1Block,
  "heading-2": heading2Block,
  "heading-3": heading3Block,
  "bulleted-list": bulletedListBlock,
  "numbered-list": numberedListBlock,
  quote: quoteBlock,
  "code-block": codeBlock,
  divider: dividerBlock,
};

/** The Pages handle of a document block type. */
export function documentBlockHandle(
  type: DocumentBlockType,
): BlockHandle<unknown> {
  return HANDLES[type];
}

/** Whether `type` names a block a document field can hold. */
export function isDocumentBlockType(type: string): type is DocumentBlockType {
  return (DOCUMENT_BLOCK_TYPES as readonly string[]).includes(type);
}

/**
 * The text format of one document field: which blocks it holds and how its
 * markdown is spelled — Pages' dialect, over a handle set the caller picks.
 *
 * The three switches are `MarkdownContext`'s own, required for the same reason
 * they are there: only the caller knows who reads the text back. A Mail body
 * (read back by us, a blank line a paragraph) is
 * `{ blankLines: "empty-block", emptyBlocks: "blank-line", softBreaks: "newline" }`.
 */
export interface DocumentDialect {
  /** The blocks the field holds. Always includes `"text"` (asserted). */
  blocks: readonly DocumentBlockType[];
  blankLines: MarkdownContext["blankLines"];
  emptyBlocks: MarkdownContext["emptyBlocks"];
  softBreaks: MarkdownContext["softBreaks"];
}

/**
 * The `MarkdownContext` of a dialect. No protected spans: a document field
 * holds no inline tokens (page links, dates) — adding them is a field feature
 * (their nodes, their renderers), not a dialect switch.
 */
export function documentMarkdownContext(
  dialect: DocumentDialect,
): MarkdownContext {
  if (!dialect.blocks.includes("text")) {
    throw new Error(
      `documentMarkdownContext: a document holds paragraphs — "text" must be among its blocks (got ${dialect.blocks.join(", ")})`,
    );
  }
  return {
    handles: dialect.blocks.map(documentBlockHandle),
    protectedSpans: [],
    blankLines: dialect.blankLines,
    emptyBlocks: dialect.emptyBlocks,
    softBreaks: dialect.softBreaks,
  };
}

/** A document's text, read as Pages' block forest. */
export function parseDocument(
  value: string,
  dialect: DocumentDialect,
): SerializedBlock[] {
  return parseMarkdownToForest(value, documentMarkdownContext(dialect));
}

/** A forest, written as a document's text. */
export function serializeDocument(
  forest: SerializedBlock[],
  dialect: DocumentDialect,
): string {
  return serializeForestToMarkdown(forest, documentMarkdownContext(dialect));
}
