import {
  $createLineBreakNode,
  $createTextNode,
  $getNodeByKey,
  type LexicalNode,
  type NodeKey,
} from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
import { pastedTextNode } from "../../core";
import { PastedTextBlock } from "../components/pasted-text-block";

/**
 * The browser half of the pasted block: the family declared in `core/node.ts`,
 * drawn as the block. A block-level box inside the line it sits in — the text
 * typed before it stays above it, the text after it below.
 */
export const pastedTextWebNode = pastedTextNode.decorated({
  className: "block w-full",
  render: ({ body }, node) => (
    <PastedTextDecoration body={body} nodeKey={node.getKey()} />
  ),
});

export function $createPastedTextNode(body: string): LexicalNode {
  return pastedTextWebNode.create({ body });
}

function PastedTextDecoration({
  body,
  nodeKey,
}: {
  body: string;
  nodeKey: NodeKey;
}) {
  const [editor] = useLexicalComposerContext();
  // Live: a composer disabled while it sends shows the block read-only.
  const editable = useLexicalEditable();
  if (!editable) return <PastedTextBlock body={body} />;
  const withNode = (fn: (node: LexicalNode) => void) =>
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (node === null)
        throw new Error(`pasted-text: node ${nodeKey} is gone from the editor`);
      fn(node);
    });
  return (
    <PastedTextBlock
      body={body}
      editing={{
        onChange: (next) =>
          withNode((node) => pastedTextWebNode.setFields(node, { body: next })),
        onDelete: () => withNode((node) => node.remove()),
        onExpand: () =>
          withNode((node) => {
            // The body back as the text it was: real line breaks, never a
            // literal "\n" inside a text node (it has no caret rect).
            const parts: LexicalNode[] = [];
            body.split("\n").forEach((line, i) => {
              if (i > 0) parts.push($createLineBreakNode());
              if (line) parts.push($createTextNode(line));
            });
            if (parts.length === 0) {
              node.remove();
              return;
            }
            let at: LexicalNode = node;
            for (const part of parts) {
              at.insertAfter(part);
              at = part;
            }
            node.remove();
            at.selectEnd();
          }),
      }}
    />
  );
}
