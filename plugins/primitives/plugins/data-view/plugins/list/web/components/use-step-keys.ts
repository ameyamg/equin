import type { RefObject } from "react";
import {
  visibleSections,
  type DataViewRenderProps,
  type DataViewSection,
} from "@plugins/primitives/plugins/data-view/core";
import {
  PLAIN_GESTURE,
  runActivation,
} from "@plugins/primitives/plugins/link-gesture/core";
import { useSurfaceShortcuts } from "@plugins/primitives/plugins/shortcuts/web";
import { revealElement } from "@plugins/primitives/plugins/dom/plugins/scroll-reveal/web";

/**
 * The rows a reader steps through, in the order drawn: a collapsed section's
 * rows are not drawn, nor those of a section under a collapsed one. Rows
 * attached under another row (`entry.children`) are not stepped to: they are
 * the parent's, opened from it.
 */
export function stepOrder(
  sections: readonly DataViewSection<unknown>[],
  collapsed: ReadonlySet<string> | undefined,
): { key: string; row: unknown }[] {
  return visibleSections(sections, collapsed).flatMap((s) =>
    s.key !== null && collapsed?.has(s.key) === true
      ? []
      : s.entries.map((e) => ({ key: e.key, row: e.row })),
  );
}

/** The row `delta` steps from `selected` lands on; `null` at either end (no wrap). */
export function stepTarget<T extends { key: string }>(
  order: readonly T[],
  selected: string | undefined,
  delta: 1 | -1,
): T | null {
  const at =
    selected === undefined ? -1 : order.findIndex((r) => r.key === selected);
  // Nothing selected (or the selection is not drawn): j takes the first row, k nothing.
  if (at === -1) return delta === 1 ? (order[0] ?? null) : null;
  return order[at + delta] ?? null;
}

/**
 * `ListViewOptions.stepKeys`: j / k run the row activation of the next /
 * previous row as drawn — the same activation a click runs — and bring that
 * row into view inside the list's `root`. Bound on the surface (one stepping
 * list per surface: a second one registers the same keys).
 */
export function useStepKeys({
  enabled,
  root,
  sections,
  collapsedSections,
  selectedRowId,
  rowActivation,
}: {
  enabled: boolean;
  root: RefObject<HTMLElement | null>;
  sections: readonly DataViewSection<unknown>[];
  collapsedSections: ReadonlySet<string> | undefined;
  selectedRowId: string | undefined;
  rowActivation: DataViewRenderProps<unknown>["rowActivation"];
}): void {
  if (enabled && rowActivation === undefined)
    throw new Error(
      "data-view list: `stepKeys` needs a row activation — the step runs the row's",
    );
  const step = (delta: 1 | -1) => {
    const target = stepTarget(
      stepOrder(sections, collapsedSections),
      selectedRowId,
      delta,
    );
    if (target === null) return;
    const act = rowActivation?.(target.row);
    if (act === undefined) return;
    runActivation(act, PLAIN_GESTURE);
    revealElement(
      root.current?.querySelector(`[data-row-key="${CSS.escape(target.key)}"]`),
      { block: "nearest", scope: "nearest" },
    );
  };
  useSurfaceShortcuts(
    enabled
      ? [
          {
            id: "data-view.list.step-next",
            keys: "j",
            label: "Next row",
            group: "List",
            handler: () => step(1),
          },
          {
            id: "data-view.list.step-previous",
            keys: "k",
            label: "Previous row",
            group: "List",
            handler: () => step(-1),
          },
        ]
      : [],
  );
}
