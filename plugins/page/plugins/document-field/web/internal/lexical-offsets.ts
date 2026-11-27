import {
  $createRangeSelection,
  $isElementNode,
  $isTextNode,
  $setSelection,
  type ElementNode,
  type LexicalNode,
  type PointType,
} from "lexical";

/**
 * A point's offset in the text of `element` — its descendants' text in order,
 * a line break counting one. The offset basis a document field's block points
 * and source offsets are stated in.
 */
export function $offsetWithin(element: ElementNode, point: PointType): number {
  const target = point.getNode();
  let total = 0;
  let done = false;
  const visit = (node: LexicalNode): void => {
    if (done) return;
    if (point.type === "element" && node.is(target) && $isElementNode(node)) {
      const kids = node.getChildren();
      for (let i = 0; i < point.offset && i < kids.length; i++)
        total += kids[i]!.getTextContentSize();
      done = true;
      return;
    }
    if ($isElementNode(node)) {
      for (const child of node.getChildren()) {
        visit(child);
        if (done) return;
      }
      return;
    }
    if (node.is(target)) {
      total += point.offset;
      done = true;
      return;
    }
    total += node.getTextContentSize();
  };
  visit(element);
  return total;
}

type PointSpec = { key: string; offset: number; type: "text" | "element" };

/** The point at `offset` in the text of `element` (clamped to its end). */
export function $pointWithin(element: ElementNode, offset: number): PointSpec {
  let cum = 0;
  let found: PointSpec | null = null;
  const visit = (node: LexicalNode): void => {
    if (found) return;
    if ($isElementNode(node)) {
      for (const child of node.getChildren()) {
        visit(child);
        if (found) return;
      }
      return;
    }
    const size = node.getTextContentSize();
    if ($isTextNode(node) && offset <= cum + size) {
      found = { key: node.getKey(), offset: offset - cum, type: "text" };
      return;
    }
    if (offset <= cum) {
      // Before a line break (or another non-text leaf): an element point.
      const parent = node.getParentOrThrow();
      found = {
        key: parent.getKey(),
        offset: node.getIndexWithinParent(),
        type: "element",
      };
      return;
    }
    cum += size;
  };
  visit(element);
  return (
    found ?? {
      key: element.getKey(),
      offset: element.getChildrenSize(),
      type: "element",
    }
  );
}

/** Select `[anchor, focus]`, each given as a point spec. */
export function $selectPoints(anchor: PointSpec, focus: PointSpec): void {
  const selection = $createRangeSelection();
  selection.anchor.set(anchor.key, anchor.offset, anchor.type);
  selection.focus.set(focus.key, focus.offset, focus.type);
  $setSelection(selection);
}
