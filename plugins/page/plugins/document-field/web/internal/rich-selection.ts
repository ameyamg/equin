import {
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  type PointType,
} from "lexical";
import type { BlockPoint } from "../../core";
import { $leafBlocks } from "./forest-lexical";
import { $offsetWithin, $pointWithin, $selectPoints } from "./lexical-offsets";
import { $isDocRuleNode } from "./nodes";
import { $blockOf } from "./rich-plugins";

function $pointOf(point: PointType): BlockPoint | null {
  const block = $blockOf(point.getNode());
  if (!block) return null;
  const index = $leafBlocks().findIndex((b) => b.is(block));
  if (index < 0) return null;
  return {
    block: index,
    offset: $isElementNode(block) ? $offsetWithin(block, point) : 0,
  };
}

/** The rich selection as block points, or `null` when it is not in a block. */
export function $richBlockSelection(): {
  anchor: BlockPoint;
  focus: BlockPoint;
} | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  const anchor = $pointOf(selection.anchor);
  const focus = $pointOf(selection.focus);
  return anchor && focus ? { anchor, focus } : null;
}

/** Select block points in the rich editor (a rule's point lands on the block after it). */
export function $selectRichBlocks(sel: {
  anchor: BlockPoint;
  focus: BlockPoint;
}): void {
  const leaves = $leafBlocks();
  const spec = (point: BlockPoint) => {
    let index = Math.min(point.block, leaves.length - 1);
    let offset = point.block < leaves.length ? point.offset : Infinity;
    while (index < leaves.length - 1 && $isDocRuleNode(leaves[index])) {
      index++;
      offset = 0;
    }
    let leaf = leaves[index]!;
    while (index > 0 && $isDocRuleNode(leaf)) {
      leaf = leaves[--index]!;
      offset = Infinity;
    }
    if (!$isElementNode(leaf)) return null;
    return $pointWithin(leaf, Math.min(offset, leaf.getTextContentSize()));
  };
  const anchor = spec(sel.anchor);
  const focus = spec(sel.focus);
  if (anchor && focus) $selectPoints(anchor, focus);
}
