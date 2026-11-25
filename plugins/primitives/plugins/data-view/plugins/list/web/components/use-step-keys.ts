import { useState, type RefObject } from "react";
import {
  visibleSections,
  type DataViewRenderProps,
  type DataViewSection,
  type DataViewSectionPaging,
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
): StepEntry[] {
  return visibleSections(sections, collapsed).flatMap((s) =>
    s.key !== null && collapsed?.has(s.key) === true
      ? []
      : s.entries.map((e) => ({
          key: e.key,
          row: e.row,
          section: s.key,
          ...(s.paging === undefined ? {} : { paging: s.paging }),
        })),
  );
}

/** One row a reader steps to, with the section it is drawn in. */
export interface StepEntry {
  key: string;
  row: unknown;
  section: string | null;
  /** The section's own read, when it pages one (a declared section). */
  paging?: DataViewSectionPaging;
}

/**
 * What a step does: land on a row, or — j on the last loaded row of a
 * section whose own read has more — grow that section first, so the step
 * never skips the rows not loaded yet (the next j lands on the first of
 * them). `null`: nothing to step to.
 */
export type StepPlan =
  | { kind: "row"; target: StepEntry }
  | { kind: "grow"; paging: DataViewSectionPaging }
  | null;

export function stepPlan(
  order: readonly StepEntry[],
  selected: string | undefined,
  delta: 1 | -1,
): StepPlan {
  const at =
    selected === undefined ? -1 : order.findIndex((r) => r.key === selected);
  const here = order[at];
  if (delta === 1 && here?.paging?.canGrow === true) {
    const next = order[at + 1];
    if (next === undefined || next.section !== here.section)
      return { kind: "grow", paging: here.paging };
  }
  const target = stepTarget(order, selected, delta);
  return target === null ? null : { kind: "row", target };
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
 * row into view inside the list's `root`.
 *
 * The keys belong to the list's region (`root`, shortcuts' `ShortcutRegion`):
 * with two stepping lists on one surface, the one holding focus (else the
 * pointer) steps; a list alone on its surface steps wherever the key lands.
 *
 * Returns the key a windowed section must reveal (`VirtualRows.revealKey`):
 * a row stepped to that its window has not mounted is scrolled to by the
 * window, not found in the DOM. Past a declared section's loaded rows the
 * step grows that section's read ({@link stepPlan}); past a flat paged
 * read's, revealing its tail row is what pages it (the body loads the next
 * page while the tail is on screen).
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
}): string | null {
  if (enabled && rowActivation === undefined)
    throw new Error(
      "data-view list: `stepKeys` needs a row activation — the step runs the row's",
    );
  const [revealKey, setRevealKey] = useState<string | null>(null);
  const step = (delta: 1 | -1) => {
    const plan = stepPlan(
      stepOrder(sections, collapsedSections),
      selectedRowId,
      delta,
    );
    if (plan === null) return;
    if (plan.kind === "grow") {
      if (!plan.paging.growing) plan.paging.loadMore();
      return;
    }
    const { target } = plan;
    const act = rowActivation?.(target.row);
    if (act === undefined) return;
    runActivation(act, PLAIN_GESTURE);
    setRevealKey(target.key);
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
            region: { root, pointer: true },
            handler: () => step(1),
          },
          {
            id: "data-view.list.step-previous",
            keys: "k",
            label: "Previous row",
            group: "List",
            region: { root, pointer: true },
            handler: () => step(-1),
          },
        ]
      : [],
  );
  return enabled ? revealKey : null;
}
