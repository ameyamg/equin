import type { ReactNode } from "react";
import {
  $applyNodeReplacement,
  $createLineBreakNode,
  $createTextNode,
  $isLineBreakNode,
  DecoratorNode,
  ElementNode,
  ParagraphNode,
  type EditorConfig,
  type ElementDOMSlot,
  type LexicalNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type RangeSelection,
  type SerializedElementNode,
  type SerializedLexicalNode,
  type SerializedParagraphNode,
  type Spread,
} from "lexical";
import type { BlockTextVariant } from "@plugins/page/plugins/editor/core";
import {
  documentBlockHandle,
  isDocumentBlockType,
  type DocumentBlockType,
} from "../../core";

/**
 * The four shapes a document block takes in the rich editor, derived from its
 * Pages handle — never from its type name:
 *
 * - `line` — a text-bearing block (paragraph, heading, list item): one
 *   {@link DocLineNode};
 * - `container` — an anchor (quote): a {@link DocQuoteNode} holding blocks;
 * - `code` — a void block written as a fence: a {@link DocCodeNode} holding its
 *   text;
 * - `rule` — any other void block: a {@link DocRuleNode}.
 *
 * A nested block is a block with a deeper `indent` right after its parent —
 * Pages' forest is flat lines here, the way the page editor renders it.
 */
export type DocumentBlockShape = "line" | "container" | "code" | "rule";

export function shapeOf(type: DocumentBlockType): DocumentBlockShape {
  const handle = documentBlockHandle(type);
  if (handle.anchor) return "container";
  if (handle.acceptsText) return "line";
  if (handle.markdown?.fence) return "code";
  return "rule";
}

function assertType(type: string): DocumentBlockType {
  if (!isDocumentBlockType(type))
    throw new Error(`document-field: "${type}" is not a document block type`);
  return type;
}

// A text variant's role utility, as literal classes (Tailwind emits literals only).
const VARIANT_CLASS: Record<BlockTextVariant, string> = {
  title: "text-title",
  heading: "text-heading",
  subheading: "text-subheading",
  body: "text-body",
  label: "text-label",
  caption: "text-caption",
};

const LINE_TEXT_ATTR = "data-doc-line-text";
/** The marker glyph of a list line; its text is written by `MarkersPlugin`. */
export const LINE_MARKER_ATTR = "data-doc-marker";

// ---------------------------------------------------------------------------
// line
// ---------------------------------------------------------------------------

export type SerializedDocLineNode = Spread<
  { blockType: string },
  SerializedParagraphNode
>;

/**
 * A text-bearing block: its type, its indent (depth) and its text. A
 * `ParagraphNode`, so it replaces every paragraph Lexical would create
 * (Enter, an emptied editor, a paste) — a paragraph IS a `text` line.
 *
 * Enter and Backspace follow the block's own handle, as in Pages: a split
 * continues as `splitInto` (a heading's tail is prose, a list continues),
 * Backspace at the start resets a list item to `resetToOnBackspaceAtStart`,
 * then outdents, then leaves a quote.
 */
export class DocLineNode extends ParagraphNode {
  __blockType: DocumentBlockType;

  static getType(): string {
    return "doc-line";
  }

  static clone(node: DocLineNode): DocLineNode {
    return new DocLineNode(node.__blockType, node.__key);
  }

  constructor(blockType: DocumentBlockType = "text", key?: NodeKey) {
    super(key);
    this.__blockType = blockType;
  }

  getBlockType(): DocumentBlockType {
    return this.getLatest().__blockType;
  }

  setBlockType(type: DocumentBlockType): this {
    const self = this.getWritable();
    self.__blockType = type;
    return self;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const handle = documentBlockHandle(this.__blockType);
    const dom = document.createElement("div");
    dom.dataset.blockType = this.__blockType;
    const variant = VARIANT_CLASS[handle.textVariant ?? "body"];
    const listy =
      handle.marker !== undefined || handle.ordinalMarker !== undefined;
    dom.className = listy ? `flex gap-xs ${variant}` : variant;
    if (handle.semantics) {
      dom.setAttribute("role", handle.semantics.role);
      if ("level" in handle.semantics)
        dom.setAttribute("aria-level", String(handle.semantics.level));
    }
    if (listy) {
      const marker = document.createElement("span");
      marker.setAttribute(LINE_MARKER_ATTR, "");
      marker.setAttribute("aria-hidden", "true");
      marker.contentEditable = "false";
      marker.className =
        "w-[1.5em] shrink-0 select-none text-end text-muted-foreground";
      marker.textContent = handle.marker ?? handle.ordinalMarker?.(1) ?? "";
      dom.append(marker);
    }
    const text = document.createElement("div");
    text.setAttribute(LINE_TEXT_ATTR, "");
    text.className = "min-w-0 flex-1";
    dom.append(text);
    void config;
    return dom;
  }

  getDOMSlot(element: HTMLElement): ElementDOMSlot<HTMLElement> {
    const text = element.querySelector<HTMLElement>(`[${LINE_TEXT_ATTR}]`);
    if (!text) throw new Error("DocLineNode: its DOM has no text slot");
    return super.getDOMSlot(element).withElement(text);
  }

  updateDOM(prev: this, dom: HTMLElement, config: EditorConfig): boolean {
    // A type change is a new look (marker, size, role): recreate.
    return (
      prev.__blockType !== this.__blockType ||
      super.updateDOM(prev, dom, config)
    );
  }

  static importJSON(json: SerializedDocLineNode): DocLineNode {
    return $createDocLineNode(assertType(json.blockType)).updateFromJSON(json);
  }

  updateFromJSON(json: LexicalUpdateJSON<SerializedDocLineNode>): this {
    return super.updateFromJSON(json);
  }

  exportJSON(): SerializedDocLineNode {
    return {
      ...super.exportJSON(),
      type: "doc-line",
      blockType: this.__blockType,
    };
  }

  insertNewAfter(
    selection: RangeSelection,
    restoreSelection: boolean,
  ): DocLineNode {
    const handle = documentBlockHandle(this.__blockType);
    const split = handle.splitInto;
    const next = $createDocLineNode(
      split && isDocumentBlockType(split) ? split : this.__blockType,
    );
    next.setIndent(this.getIndent());
    next.setDirection(this.getDirection());
    this.insertAfter(next, restoreSelection);
    void selection;
    return next;
  }

  collapseAtStart(): boolean {
    const handle = documentBlockHandle(this.__blockType);
    const reset = handle.resetToOnBackspaceAtStart;
    if (reset && isDocumentBlockType(reset)) {
      this.setBlockType(reset);
      return true;
    }
    if (this.getIndent() > 0) {
      this.setIndent(this.getIndent() - 1);
      return true;
    }
    const parent = this.getParent();
    if ($isDocQuoteNode(parent) && this.getPreviousSibling() === null) {
      $unwrapQuote(parent);
      return true;
    }
    // Lexical's own: an empty first line goes when there is another to go to.
    return super.collapseAtStart();
  }
}

export function $createDocLineNode(
  type: DocumentBlockType = "text",
): DocLineNode {
  return $applyNodeReplacement(new DocLineNode(type));
}

export function $isDocLineNode(
  node: LexicalNode | null | undefined,
): node is DocLineNode {
  return node instanceof DocLineNode;
}

// ---------------------------------------------------------------------------
// container
// ---------------------------------------------------------------------------

export type SerializedDocQuoteNode = Spread<
  { blockType: string },
  SerializedElementNode
>;

/**
 * A container block (a quote): a shadow root holding blocks, its bar spanning
 * all of them. Emptied, it goes (`canBeEmpty`).
 */
export class DocQuoteNode extends ElementNode {
  __blockType: DocumentBlockType;

  static getType(): string {
    return "doc-quote";
  }

  static clone(node: DocQuoteNode): DocQuoteNode {
    return new DocQuoteNode(node.__blockType, node.__key);
  }

  constructor(blockType: DocumentBlockType = "quote", key?: NodeKey) {
    super(key);
    this.__blockType = blockType;
  }

  getBlockType(): DocumentBlockType {
    return this.getLatest().__blockType;
  }

  createDOM(): HTMLElement {
    const dom = document.createElement("div");
    dom.dataset.blockType = this.__blockType;
    dom.className =
      "my-2xs border-s-[3px] border-border ps-sm text-muted-foreground";
    return dom;
  }

  updateDOM(): boolean {
    return false;
  }

  isShadowRoot(): boolean {
    return true;
  }

  canBeEmpty(): boolean {
    return false;
  }

  canIndent(): boolean {
    return true;
  }

  static importJSON(json: SerializedDocQuoteNode): DocQuoteNode {
    return $createDocQuoteNode(assertType(json.blockType)).updateFromJSON(json);
  }

  exportJSON(): SerializedDocQuoteNode {
    return {
      ...super.exportJSON(),
      type: "doc-quote",
      blockType: this.__blockType,
    };
  }
}

export function $createDocQuoteNode(
  type: DocumentBlockType = "quote",
): DocQuoteNode {
  return $applyNodeReplacement(new DocQuoteNode(type));
}

export function $isDocQuoteNode(
  node: LexicalNode | null | undefined,
): node is DocQuoteNode {
  return node instanceof DocQuoteNode;
}

/** Dissolve a quote: its blocks take its place, at its depth. */
export function $unwrapQuote(quote: DocQuoteNode): void {
  const depth = quote.getIndent();
  let at: LexicalNode = quote;
  for (const child of quote.getChildren()) {
    if (child instanceof ElementNode)
      child.setIndent(child.getIndent() + depth);
    else if ($isDocRuleNode(child)) child.setIndent(child.getIndent() + depth);
    at.insertAfter(child);
    at = child;
  }
  quote.remove();
}

// ---------------------------------------------------------------------------
// code
// ---------------------------------------------------------------------------

export type SerializedDocCodeNode = Spread<
  { blockType: string; language: string | null },
  SerializedElementNode
>;

/**
 * A fenced block: its text (lines as `LineBreakNode`s) and its language, in a
 * monospace box. Its text carries no marks (`CodePlainPlugin` strips them) —
 * a fence holds characters, not runs.
 */
export class DocCodeNode extends ElementNode {
  __blockType: DocumentBlockType;
  __language: string | null;

  static getType(): string {
    return "doc-code";
  }

  static clone(node: DocCodeNode): DocCodeNode {
    return new DocCodeNode(node.__blockType, node.__language, node.__key);
  }

  constructor(
    blockType: DocumentBlockType = "code-block",
    language: string | null = null,
    key?: NodeKey,
  ) {
    super(key);
    this.__blockType = blockType;
    this.__language = language;
  }

  getBlockType(): DocumentBlockType {
    return this.getLatest().__blockType;
  }

  getLanguage(): string | null {
    return this.getLatest().__language;
  }

  createDOM(): HTMLElement {
    const dom = document.createElement("pre");
    dom.dataset.blockType = this.__blockType;
    dom.className =
      "my-2xs whitespace-pre-wrap rounded-md bg-muted px-sm py-xs font-mono text-code";
    return dom;
  }

  updateDOM(): boolean {
    return false;
  }

  canIndent(): boolean {
    return true;
  }

  insertNewAfter(): DocLineNode {
    const next = $createDocLineNode("text");
    next.setIndent(this.getIndent());
    this.insertAfter(next);
    return next;
  }

  collapseAtStart(): boolean {
    // An emptied box becomes a paragraph; a full one is not merged into the
    // line above (that would turn code into prose).
    if (this.getTextContentSize() === 0) {
      const line = $createDocLineNode("text");
      line.setIndent(this.getIndent());
      this.replace(line);
      line.select(0, 0);
    }
    return true;
  }

  static importJSON(json: SerializedDocCodeNode): DocCodeNode {
    return $createDocCodeNode(
      assertType(json.blockType),
      json.language,
    ).updateFromJSON(json);
  }

  exportJSON(): SerializedDocCodeNode {
    return {
      ...super.exportJSON(),
      type: "doc-code",
      blockType: this.__blockType,
      language: this.__language,
    };
  }
}

export function $createDocCodeNode(
  type: DocumentBlockType = "code-block",
  language: string | null = null,
): DocCodeNode {
  return $applyNodeReplacement(new DocCodeNode(type, language));
}

export function $isDocCodeNode(
  node: LexicalNode | null | undefined,
): node is DocCodeNode {
  return node instanceof DocCodeNode;
}

/** Fill a code box with `code`, a `LineBreakNode` per newline. */
export function $setCodeText(node: DocCodeNode, code: string): void {
  node.clear();
  code.split("\n").forEach((line, i) => {
    if (i > 0) node.append($createLineBreakNode());
    if (line) node.append($createTextNode(line));
  });
}

/** A code box's text: its characters, a newline per `LineBreakNode`. */
export function $codeText(node: DocCodeNode): string {
  return node
    .getChildren()
    .map((c) => ($isLineBreakNode(c) ? "\n" : c.getTextContent()))
    .join("");
}

// ---------------------------------------------------------------------------
// rule
// ---------------------------------------------------------------------------

export type SerializedDocRuleNode = Spread<
  { blockType: string; indent: number },
  SerializedLexicalNode
>;

/** A void block with nothing to edit (a divider): a rule across the field. */
export class DocRuleNode extends DecoratorNode<ReactNode> {
  __blockType: DocumentBlockType;
  __indent: number;

  static getType(): string {
    return "doc-rule";
  }

  static clone(node: DocRuleNode): DocRuleNode {
    return new DocRuleNode(node.__blockType, node.__indent, node.__key);
  }

  constructor(
    blockType: DocumentBlockType = "divider",
    indent = 0,
    key?: NodeKey,
  ) {
    super(key);
    this.__blockType = blockType;
    this.__indent = indent;
  }

  getBlockType(): DocumentBlockType {
    return this.getLatest().__blockType;
  }

  getIndent(): number {
    return this.getLatest().__indent;
  }

  setIndent(indent: number): this {
    const self = this.getWritable();
    self.__indent = indent;
    return self;
  }

  createDOM(): HTMLElement {
    const dom = document.createElement("div");
    dom.dataset.blockType = this.__blockType;
    dom.className = "py-xs";
    return dom;
  }

  updateDOM(): boolean {
    return false;
  }

  isInline(): boolean {
    return false;
  }

  decorate(): ReactNode {
    return <hr className="border-border" />;
  }

  static importJSON(json: SerializedDocRuleNode): DocRuleNode {
    return $createDocRuleNode(assertType(json.blockType), json.indent);
  }

  exportJSON(): SerializedDocRuleNode {
    return {
      ...super.exportJSON(),
      type: "doc-rule",
      blockType: this.__blockType,
      indent: this.__indent,
    };
  }
}

export function $createDocRuleNode(
  type: DocumentBlockType = "divider",
  indent = 0,
): DocRuleNode {
  return $applyNodeReplacement(new DocRuleNode(type, indent));
}

export function $isDocRuleNode(
  node: LexicalNode | null | undefined,
): node is DocRuleNode {
  return node instanceof DocRuleNode;
}

/** A block node of the field — what a forest block becomes. */
export type DocBlockNode =
  DocLineNode | DocQuoteNode | DocCodeNode | DocRuleNode;

export function $isDocBlockNode(
  node: LexicalNode | null | undefined,
): node is DocBlockNode {
  return (
    $isDocLineNode(node) ||
    $isDocQuoteNode(node) ||
    $isDocCodeNode(node) ||
    $isDocRuleNode(node)
  );
}

/** The nodes a rich document field registers, and the paragraph replacement. */
export const DOC_RICH_NODES = [
  DocLineNode,
  DocQuoteNode,
  DocCodeNode,
  DocRuleNode,
  {
    replace: ParagraphNode,
    with: () => new DocLineNode("text"),
    withKlass: DocLineNode,
  },
] as const;
