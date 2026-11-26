import { describe, it, expect } from "bun:test";
import {
  $getRoot,
  $isElementNode,
  createEditor,
  type LexicalNode,
} from "lexical";
import { tokenExtension } from "@plugins/primitives/plugins/text-editor/plugins/token-extension/core";
import { defineInlineTokenNode } from "@plugins/primitives/plugins/text-editor/plugins/token-extension/plugins/node/core";
import { applyMarkdownToEditor, serializeEditorToMarkdown } from "./markdown";

// A token whose text holds newlines (the pasted block's shape), and an ordinary
// one-line token, to check the two scans compose.
const blockNode = defineInlineTokenNode<{ body: string }>({
  type: "spanning-test-block",
  fields: ["body"],
  token: ({ body }) => `<blk>\n${body}\n</blk>`,
  fieldsOf: (m) => ({ body: m[1]! }),
  textContent: "token",
});
const idNode = defineInlineTokenNode<{ raw: string }>({
  type: "spanning-test-id",
  fields: ["raw"],
  token: ({ raw }) => raw,
  fieldsOf: (m) => ({ raw: m[0] }),
  textContent: "token",
});
const BLOCK = tokenExtension({
  id: "blk",
  pattern: /<blk>\n([\s\S]*?)\n<\/blk>/,
  node: blockNode,
  spansLines: true,
});
const ID = tokenExtension({ id: "id", pattern: /\bid-\d+\b/, node: idNode });

async function roundTrip(text: string, exts = [BLOCK, ID]) {
  const editor = createEditor({
    nodes: [blockNode.Node, idNode.Node],
    onError: (e) => {
      throw e;
    },
  });
  applyMarkdownToEditor(editor, text, exts);
  // A headless update commits on a microtask.
  await Promise.resolve();
  const types: string[] = [];
  const walk = (node: LexicalNode) => {
    types.push(node.getType());
    if ($isElementNode(node)) node.getChildren().forEach(walk);
  };
  editor.getEditorState().read(() => walk($getRoot()));
  return { out: serializeEditorToMarkdown(editor, exts), types };
}

describe("a token that spans lines", () => {
  it("is one node and round-trips with the text around it", async () => {
    const text = "see this:\n<blk>\nline 1\nline 2\n</blk>\nthat one id-42 ok";
    const { out, types } = await roundTrip(text);
    expect(out).toBe(text);
    expect(types.filter((t) => t === "spanning-test-block")).toHaveLength(1);
    expect(types.filter((t) => t === "spanning-test-id")).toHaveLength(1);
  });

  it("can start mid-line, and the line continues after it", async () => {
    const text = "a <blk>\nx\n</blk> b\nc";
    const { out, types } = await roundTrip(text);
    expect(out).toBe(text);
    expect(types.filter((t) => t === "spanning-test-block")).toHaveLength(1);
  });

  it("stays text in an editor that does not mark it spansLines", async () => {
    const lineOnly = tokenExtension({
      id: "blk",
      pattern: BLOCK.pattern,
      node: blockNode,
    });
    const text = "<blk>\nx\n</blk>";
    const { out, types } = await roundTrip(text, [lineOnly]);
    expect(out).toBe(text);
    expect(types).not.toContain("spanning-test-block");
  });
});
