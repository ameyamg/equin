import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  COLLABORATION_TAG,
  COMMAND_PRIORITY_LOW,
  HISTORIC_TAG,
  HISTORY_PUSH_TAG,
  INSERT_LINE_BREAK_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  PASTE_TAG,
  TextNode,
  type LexicalNode,
} from "lexical";
import { conversionPrefixesOf } from "@plugins/page/plugins/editor/core";
import {
  documentBlockHandle,
  type DocumentBlockType,
  type DocumentDialect,
} from "../../core";
import {
  $createDocCodeNode,
  $createDocLineNode,
  $createDocQuoteNode,
  $createDocRuleNode,
  $isDocBlockNode,
  $isDocCodeNode,
  $isDocLineNode,
  $isDocQuoteNode,
  DocCodeNode,
  DocQuoteNode,
  type DocLineNode,
  LINE_MARKER_ATTR,
  shapeOf,
  type DocBlockNode,
} from "./nodes";

/** The block node holding `node` (itself, when it is one), never a container. */
export function $blockOf(node: LexicalNode | null): DocBlockNode | null {
  for (let cur = node; cur; cur = cur.getParent()) {
    if ($isDocBlockNode(cur) && !$isDocQuoteNode(cur)) return cur;
  }
  return null;
}

/**
 * Enter and Tab, where a document field's blocks differ from a paragraph's:
 *
 * - Enter in a code box is a new line of code; on an empty last line it leaves
 *   the box.
 * - Enter on an empty line escapes one level per press, as in Pages: outdent,
 *   then the type's `breakOutOnEmptyEnter` (a list item becomes a paragraph),
 *   then out of the quote it ends.
 * - Tab / Shift+Tab indent / outdent every block the selection touches, never
 *   deeper than one past the block above.
 */
export function RichKeysPlugin({ dialect }: { dialect: DocumentDialect }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    // A soft break the dialect writes as a real newline reads back as a new
    // block: in such a dialect a line break outside code IS a new block.
    const offBreak =
      dialect.softBreaks === "newline"
        ? editor.registerCommand(
            INSERT_LINE_BREAK_COMMAND,
            () => {
              const selection = $getSelection();
              if (!$isRangeSelection(selection)) return false;
              if ($isDocCodeNode($blockOf(selection.anchor.getNode())))
                return false;
              selection.insertParagraph();
              return true;
            },
            COMMAND_PRIORITY_LOW,
          )
        : () => {};
    const offEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        if (event?.shiftKey) return false;
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed())
          return false;
        const block = $blockOf(selection.anchor.getNode());
        if ($isDocCodeNode(block)) {
          event?.preventDefault();
          const last = block.getLastChild();
          const atEnd =
            selection.anchor.getNode().is(block) &&
            selection.anchor.offset === block.getChildrenSize();
          if (atEnd && $isLineBreakNode(last)) {
            last.remove();
            block.insertNewAfter().select(0, 0);
          } else selection.insertLineBreak();
          return true;
        }
        if (!$isDocLineNode(block) || block.getTextContentSize() > 0)
          return false;
        if (block.getIndent() > 0) {
          event?.preventDefault();
          block.setIndent(block.getIndent() - 1);
          return true;
        }
        const out = documentBlockHandle(
          block.getBlockType(),
        ).breakOutOnEmptyEnter;
        if (out && out !== block.getBlockType()) {
          event?.preventDefault();
          block.setBlockType(out as DocumentBlockType);
          return true;
        }
        const parent = block.getParent();
        if ($isDocQuoteNode(parent) && block.getNextSibling() === null) {
          event?.preventDefault();
          block.setIndent(parent.getIndent());
          parent.insertAfter(block);
          if (parent.getChildrenSize() === 0) parent.remove();
          block.select(0, 0);
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
    const offTab = editor.registerCommand(
      KEY_TAB_COMMAND,
      (event: KeyboardEvent) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return false;
        const blocks: DocBlockNode[] = [];
        for (const node of selection.getNodes()) {
          const block = $blockOf(node);
          if (block && !blocks.some((b) => b.is(block))) blocks.push(block);
        }
        if (blocks.length === 0) return false;
        event.preventDefault();
        for (const block of blocks) {
          const indent = block.getIndent();
          if (event.shiftKey) {
            if (indent > 0) block.setIndent(indent - 1);
            continue;
          }
          const prev = block.getPreviousSibling();
          // Never nested under a container by indent: its children are inside
          // it, so a deeper line after one would be its sibling in the text.
          const max = !$isDocBlockNode(prev)
            ? 0
            : $isDocQuoteNode(prev)
              ? prev.getIndent()
              : prev.getIndent() + 1;
          if (indent < max) block.setIndent(indent + 1);
        }
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
    return () => {
      offBreak();
      offEnter();
      offTab();
    };
  }, [editor, dialect]);
  return null;
}

/**
 * Typing a block's prefix at the start of a paragraph turns it into that
 * block — `# `, `- `, `1. `, `| ` (a quote), `---`, `` ``` `` — read off the
 * dialect's own handles (`conversionPrefixesOf`), so a block the field does not
 * hold has no shortcut. One undo entry restores the typed prefix.
 */
export function BlockShortcutsPlugin({
  dialect,
}: {
  dialect: DocumentDialect;
}) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const prefixes = dialect.blocks
      .filter((type) => type !== "text")
      .flatMap((type) =>
        conversionPrefixesOf(documentBlockHandle(type)).map((prefix) => ({
          prefix,
          type,
        })),
      )
      .sort((a, b) => b.prefix.length - a.prefix.length);
    let pending = false;
    return editor.registerUpdateListener(
      ({ tags, dirtyLeaves, editorState, prevEditorState }) => {
        if (pending) return;
        if (
          tags.has(HISTORIC_TAG) ||
          tags.has(COLLABORATION_TAG) ||
          tags.has(PASTE_TAG)
        )
          return;
        if (editor.isComposing()) return;
        const prev = prevEditorState.read(() => {
          const s = $getSelection();
          return $isRangeSelection(s) && s.isCollapsed()
            ? { key: s.anchor.key, offset: s.anchor.offset }
            : null;
        });
        const hit = editorState.read(() => {
          const s = $getSelection();
          if (!$isRangeSelection(s) || !s.isCollapsed()) return null;
          const node = s.anchor.getNode();
          if (!$isTextNode(node) || !dirtyLeaves.has(node.getKey()))
            return null;
          const typedOne =
            prev &&
            (prev.key === node.getKey()
              ? s.anchor.offset === prev.offset + 1
              : s.anchor.offset === 1);
          if (!typedOne) return null;
          const line = node.getParent();
          if (!$isDocLineNode(line) || line.getBlockType() !== "text")
            return null;
          if (!node.is(line.getFirstChild())) return null;
          const before = node.getTextContent().slice(0, s.anchor.offset);
          const match = prefixes.find((p) => p.prefix === before);
          return match ? { key: line.getKey(), ...match } : null;
        });
        if (!hit) return;
        pending = true;
        queueMicrotask(() => {
          pending = false;
          editor.update(
            () => {
              const line = $getNodeByKey(hit.key);
              if (!$isDocLineNode(line)) return;
              const first = line.getFirstChild();
              if (
                !$isTextNode(first) ||
                !first.getTextContent().startsWith(hit.prefix)
              )
                return;
              $convertLine(line, first, hit.prefix, hit.type);
            },
            { tag: HISTORY_PUSH_TAG },
          );
        });
      },
    );
  }, [editor, dialect]);
  return null;
}

function $convertLine(
  line: DocLineNode,
  first: TextNode,
  prefix: string,
  type: DocumentBlockType,
): void {
  const rest = first.getTextContent().slice(prefix.length);
  if (rest) first.setTextContent(rest);
  else first.remove();
  switch (shapeOf(type)) {
    case "line":
      line.setBlockType(type);
      line.selectStart();
      return;
    case "container": {
      const quote = $createDocQuoteNode(type);
      quote.setIndent(line.getIndent());
      line.setIndent(0);
      line.insertBefore(quote);
      quote.append(line);
      line.selectStart();
      return;
    }
    case "code": {
      const code = $createDocCodeNode(type);
      code.setIndent(line.getIndent());
      code.append(...line.getChildren());
      line.replace(code);
      code.selectStart();
      return;
    }
    case "rule":
      line.insertBefore($createDocRuleNode(type, line.getIndent()));
      line.selectStart();
  }
}

/**
 * Keeps the structure what the forest can say: a code box's text carries no
 * marks, and a quote holds blocks (stray text is wrapped in a line).
 */
export function NormalizePlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const offText = editor.registerNodeTransform(TextNode, (node) => {
      if (!$isDocCodeNode(node.getParent())) return;
      if (node.getFormat() !== 0) node.setFormat(0);
      if (node.getStyle() !== "") node.setStyle("");
    });
    const offQuote = editor.registerNodeTransform(DocQuoteNode, (quote) => {
      for (const child of quote.getChildren()) {
        if ($isDocBlockNode(child)) continue;
        const line = $createDocLineNode();
        child.insertBefore(line);
        line.append(child);
      }
    });
    return () => {
      offText();
      offQuote();
    };
  }, [editor]);
  return null;
}

/**
 * Writes each list line's marker — the handle's `marker`, or its
 * `ordinalMarker` of the line's place in its run of same-type siblings (a
 * deeper line does not break the run; a shallower one or another type does),
 * Pages' own numbering.
 */
export function MarkersPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          const walk = (nodes: LexicalNode[]) => {
            const runs: ({ type: string; count: number } | undefined)[] = [];
            for (const node of nodes) {
              if (!$isDocBlockNode(node)) continue;
              const depth = node.getIndent();
              runs.length = depth + 1;
              const type = node.getBlockType();
              const prev = runs[depth];
              const count = prev?.type === type ? prev.count + 1 : 1;
              runs[depth] = { type, count };
              if ($isDocQuoteNode(node)) {
                walk(node.getChildren());
                continue;
              }
              if (!$isDocLineNode(node)) continue;
              const ordinal = documentBlockHandle(type).ordinalMarker;
              if (!ordinal) continue;
              const marker = editor
                .getElementByKey(node.getKey())
                ?.querySelector(`[${LINE_MARKER_ATTR}]`);
              const text = ordinal(count);
              if (marker && marker.textContent !== text)
                marker.textContent = text;
            }
          };
          walk($getRoot().getChildren());
        });
      }),
    [editor],
  );
  return null;
}

/** For `InlineAutoformatPlugin`: no markdown autoformat inside a code box. */
export function $caretInCode(): boolean {
  const selection = $getSelection();
  return (
    $isRangeSelection(selection) &&
    $blockOf(selection.anchor.getNode()) instanceof DocCodeNode
  );
}
