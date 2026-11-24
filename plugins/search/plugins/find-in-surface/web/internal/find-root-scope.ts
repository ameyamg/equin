import { defineDomScope } from "@plugins/primitives/plugins/scope/plugins/dom-scope/web";

/**
 * The region a find bar searches. Published by `<FindRoot>`, read by the
 * `<FindBar>` of the same `<FindScope>` — the two sit apart in the tree (the
 * page pane renders its bar in the overlay layer BESIDE the scroller, outside
 * the content), so the bar can neither ref the region nor walk up to it.
 */
export const findRootScope = defineDomScope<HTMLDivElement>({
  name: "search.find-root",
  what: "the region a find bar searches (published by <FindRoot>)",
  bounds: ["data-find-root"],
});
