import { $getRoot, type ElementNode, type LexicalNode } from "lexical";
import {
  $appendRunsTo,
  $runsOfElement,
  runsOf,
  type SerializedBlock,
} from "@plugins/page/plugins/editor/core";
import {
  documentBlockHandle,
  isDocumentBlockType,
  type DocumentBlockType,
} from "../../core";
import {
  $codeText,
  $createDocCodeNode,
  $createDocLineNode,
  $createDocQuoteNode,
  $createDocRuleNode,
  $isDocBlockNode,
  $isDocCodeNode,
  $isDocLineNode,
  $isDocQuoteNode,
  $setCodeText,
  shapeOf,
  type DocBlockNode,
} from "./nodes";

function typeOf(block: SerializedBlock): DocumentBlockType {
  if (!isDocumentBlockType(block.type))
    throw new Error(
      `document-field: a "${block.type}" block cannot be in a document field`,
    );
  return block.type;
}

/**
 * Append a forest to `parent` as block nodes: each block at `depth`, its
 * children right after it one deeper — except a container's, which go INSIDE
 * it at depth 0. Must run inside an update.
 */
export function $appendForest(
  parent: ElementNode,
  forest: SerializedBlock[],
  depth = 0,
): void {
  for (const block of forest) {
    const type = typeOf(block);
    const field = (key: string): unknown =>
      typeof block.data === "object" && block.data !== null
        ? Reflect.get(block.data, key)
        : undefined;
    switch (shapeOf(type)) {
      case "container": {
        const quote = $createDocQuoteNode(type);
        quote.setIndent(depth);
        parent.append(quote);
        $appendForest(quote, block.children, 0);
        // A container holds at least one line, to put the caret in.
        if (quote.getChildrenSize() === 0) quote.append($createDocLineNode());
        continue; // its children are inside it
      }
      case "code": {
        const code = $createDocCodeNode(
          type,
          typeof field("language") === "string"
            ? (field("language") as string)
            : null,
        );
        code.setIndent(depth);
        const text = field("code");
        $setCodeText(code, typeof text === "string" ? text : "");
        parent.append(code);
        break;
      }
      case "rule":
        parent.append($createDocRuleNode(type, depth));
        break;
      case "line": {
        const line = $createDocLineNode(type);
        line.setIndent(depth);
        $appendRunsTo(line, runsOf(field("text")));
        parent.append(line);
        break;
      }
    }
    $appendForest(parent, block.children, depth + 1);
  }
}

/** Replace the editor's content with `forest`. Must run inside an update. */
export function $setRootForest(forest: SerializedBlock[]): void {
  const root = $getRoot();
  root.clear();
  $appendForest(root, forest);
  if (root.getChildrenSize() === 0) root.append($createDocLineNode());
}

function indentOf(node: DocBlockNode): number {
  return node.getIndent();
}

function blockOf(node: DocBlockNode): SerializedBlock {
  const type = node.getBlockType();
  const base = { type, expanded: true, children: [] as SerializedBlock[] };
  if ($isDocLineNode(node)) {
    const empty = (documentBlockHandle(type).empty?.() ?? {}) as object;
    return { ...base, data: { ...empty, text: $runsOfElement(node) } };
  }
  if ($isDocQuoteNode(node)) {
    return { ...base, data: {}, children: $forestOf(node.getChildren()) };
  }
  if ($isDocCodeNode(node)) {
    const language = node.getLanguage();
    return {
      ...base,
      data: { code: $codeText(node), ...(language ? { language } : {}) },
    };
  }
  return { ...base, data: {} };
}

/**
 * Read sibling block nodes back as a forest: a node one deeper than the one
 * before it is its child (Pages' indent-to-nesting rule). A container is never
 * a parent this way — its children are inside it — so a deeper line right
 * after one is its sibling.
 */
export function $forestOf(nodes: LexicalNode[]): SerializedBlock[] {
  const roots: SerializedBlock[] = [];
  // Open ancestors, outermost first: the list a deeper node joins.
  const stack: { indent: number; children: SerializedBlock[] }[] = [];
  for (const node of nodes) {
    if (!$isDocBlockNode(node))
      throw new Error(
        `document-field: a "${node.getType()}" node among the blocks — the field holds block nodes only`,
      );
    const indent = indentOf(node);
    while (stack.length > 0 && stack.at(-1)!.indent >= indent) stack.pop();
    const siblings = stack.at(-1)?.children ?? roots;
    const block = blockOf(node);
    siblings.push(block);
    stack.push({
      indent,
      // A container takes no children by indent: one deeper is its sibling.
      children: $isDocQuoteNode(node) ? siblings : block.children,
    });
  }
  return roots;
}

/** The editor's content as a forest. Must run inside a read. */
export function $rootForest(): SerializedBlock[] {
  return $forestOf($getRoot().getChildren());
}

/**
 * The leaf block nodes in document order (lines, code boxes, rules — a
 * container's are its children's): the index space a selection is carried in
 * between the field's modes, the same as `sourceLines`' `block`.
 */
export function $leafBlocks(): DocBlockNode[] {
  const out: DocBlockNode[] = [];
  const walk = (nodes: LexicalNode[]) => {
    for (const node of nodes) {
      if ($isDocQuoteNode(node)) walk(node.getChildren());
      else if ($isDocBlockNode(node)) out.push(node);
    }
  };
  walk($getRoot().getChildren());
  return out;
}
