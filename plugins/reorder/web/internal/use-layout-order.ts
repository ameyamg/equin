import { useMemo } from "react";
import type { Contribution } from "@plugins/framework/plugins/web-sdk/core";
import type { SlotHandle } from "@plugins/framework/plugins/slot-declaration/core";
import {
  mapResource,
  type ResourceResult,
} from "@plugins/network/plugins/live/plugins/live-state/web";
import type { SlotPlaced } from "@plugins/primitives/plugins/slot-render/web";
import { useReorderNodeTypes } from "@plugins/reorder/plugins/node-types/web";
import { isNodeData, type TopLevelEntry } from "./sorting";
import { useReorderedEntries } from "./use-reordered-entries";

/**
 * The contributions of `entries`, in order — a container's members in its
 * place — each marked `overflow` when it sits (at any depth) inside a node
 * whose type declares its members the slot's overflow.
 */
export function placedOf(
  entries: readonly TopLevelEntry[],
  isOverflowType: (type: string) => boolean,
  inOverflow = false,
): SlotPlaced<Contribution>[] {
  const out: SlotPlaced<Contribution>[] = [];
  for (const entry of entries) {
    if (!isNodeData(entry)) {
      out.push({ contribution: entry, overflow: inOverflow });
    } else if (entry.members) {
      out.push(
        ...placedOf(
          entry.members,
          isOverflowType,
          inOverflow || isOverflowType(entry.type),
        ),
      );
    }
  }
  return out;
}

/**
 * The layout order slot-render's `useSlotOrder` reads (`SlotRender.Order`,
 * contributed by `reorder/slot-middleware`): the slot's config tree applied
 * over its contributions — the same `useReorderedEntries` the list middleware's
 * tree comes from — with hidden contributions dropped, layout nodes (spacers,
 * dividers) dropped, and a header's members in its place; an overflow
 * node's members in its place too, marked `overflow`. Throws for a slot
 * that is not reorderable. A read, like `useReorderedEntries`: `loading` until
 * the layout is known.
 */
export function useLayoutOrder(
  slot: SlotHandle,
  contributions: readonly Contribution[],
): ResourceResult<readonly SlotPlaced<Contribution>[]> {
  const state = useReorderedEntries(slot.id, contributions);
  const nodeTypes = useReorderNodeTypes();
  return useMemo(
    () =>
      mapResource(state, (s) =>
        placedOf(s.entries, (type) => nodeTypes.get(type)?.overflow === true),
      ),
    [state, nodeTypes],
  );
}
