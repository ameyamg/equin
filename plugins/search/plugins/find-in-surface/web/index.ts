import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";

export { FindBar } from "./components/find-bar";
export type { FindBarProps } from "./components/find-bar";
export { FindRoot, FindScope } from "./components/find-root";

export default {
  description:
    "Ctrl+F inside one surface: <FindScope> around a <FindRoot> (the searched region, as drawn — no box of its own) and a <FindBar label> (pinned top-right in a non-scrolling overlay). Every match painted with the CSS Custom Highlight API (the DOM is never touched), the current one distinct and scrolled into view, a mark per match on the scroller's edge; match case / whole word; a line break in the query matches a line break on screen (Shift+Enter types one). Enter or ↓ on the last line: next; ↑ on the first line: previous; ⌘G / ⇧⌘G; Esc closes. The key goes to the region holding focus, else the one last pressed in, else the only visible one — none, and the browser's own find opens.",
  contributions: [],
} satisfies PluginDefinition;
