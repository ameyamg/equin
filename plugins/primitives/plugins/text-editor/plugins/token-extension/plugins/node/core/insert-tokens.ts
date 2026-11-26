import {
  $createLineBreakNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type LexicalNode,
} from "lexical";
import {
  matchTokens,
  type InlineTokenExtension,
} from "@plugins/primitives/plugins/text-editor/plugins/token-extension/core";

/**
 * Build the inline leaf nodes for ONE line of raw text: every token becomes its
 * decorator node, the spans between them stay text. Must run inside an
 * `editor.update()`.
 *
 * The line is unmarked by construction (a raw string carries no formatting), so
 * the scan is asked with no marks.
 */
export function $tokenizedLineNodes(
  line: string,
  extensions: readonly InlineTokenExtension[],
): LexicalNode[] {
  const out: LexicalNode[] = [];
  const pushText = (text: string) => {
    if (text) out.push($createTextNode(text));
  };
  let lastIdx = 0;
  for (const match of matchTokens(line, undefined, extensions)) {
    pushText(line.slice(lastIdx, match.start));
    // The family builds from the MATCH, so the erased scan never has to hand a
    // field record back to a family that knows its own type. `null` means
    // "not a token after all", which `matchTokens` has already ruled out for
    // everything it yields — the fallback keeps the characters rather than
    // dropping them if that ever stops being true.
    const node = match.extension.createNodeFromMatch(match.match);
    if (node) out.push(node);
    else pushText(match.text);
    lastIdx = match.end;
  }
  pushText(line.slice(lastIdx));
  return out;
}

/**
 * Build the inline leaf nodes of a whole raw text, LINE BY LINE: one node list
 * per line of the source, the shape a paragraph-per-line host materializes.
 *
 * A family that {@link InlineTokenExtension.spansLines} is scanned over the
 * whole text first, so its token (a pasted block) is ONE node even though its
 * text holds newlines: it sits in the line where it starts, and the text after
 * it continues that line. Every other family is scanned per line, exactly as
 * {@link $tokenizedLineNodes} does — with no spanning family registered this is
 * `text.split("\n").map($tokenizedLineNodes)`.
 *
 * Must run inside an `editor.update()`.
 */
export function $tokenizedTextLines(
  text: string,
  extensions: readonly InlineTokenExtension[],
): LexicalNode[][] {
  const spanning = extensions.filter((e) => e.spansLines);
  const perLine = extensions.filter((e) => !e.spansLines);
  const lines: LexicalNode[][] = [[]];
  const pushText = (chunk: string) => {
    chunk.split("\n").forEach((line, i) => {
      if (i > 0) lines.push([]);
      lines[lines.length - 1]!.push(...$tokenizedLineNodes(line, perLine));
    });
  };
  let lastIdx = 0;
  for (const match of matchTokens(text, undefined, spanning)) {
    pushText(text.slice(lastIdx, match.start));
    const node = match.extension.createNodeFromMatch(match.match);
    if (node) lines[lines.length - 1]!.push(node);
    else pushText(match.text);
    lastIdx = match.end;
  }
  pushText(text.slice(lastIdx));
  return lines;
}

/**
 * Insert raw text at the caret, materializing every token it carries as its
 * node — so a token dropped at the cursor is the same thing as the same token
 * arriving through a value round-trip. Newlines become real `LineBreakNode`s
 * (a literal `"\n"` inside a text node has no caret rect the browser can place).
 *
 * With no live selection — the editor was never focused — the text appends at
 * the end of the document rather than at the top. Must run inside an
 * `editor.update()`.
 */
export function $insertTokenizedText(
  text: string,
  extensions: readonly InlineTokenExtension[],
): void {
  let selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    $getRoot().selectEnd();
    selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
  }
  const nodes: LexicalNode[] = [];
  $tokenizedTextLines(text, extensions).forEach((line, i) => {
    if (i > 0) nodes.push($createLineBreakNode());
    nodes.push(...line);
  });
  selection.insertNodes(nodes);
}
