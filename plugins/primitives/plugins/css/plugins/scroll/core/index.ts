/**
 * Where a `<Scroll>` (or a `<Column>` with a scrolling body) is written: its
 * repo file, the component it is written in, and its place among that
 * component's scrollers (`plugins/…/sidebar.tsx#Sidebar#0`). The build writes
 * it as the element's `keep` when the element has none (this plugin's
 * `vite/index.ts`), so every scroller is kept by default under its call site —
 * never written by hand.
 */
export interface ScrollSite {
  readonly kind: "site";
  readonly site: string;
}
