import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";

export { watchStateLoss } from "./internal/detector";
export type { StateLoss } from "./internal/detector";
export { watchScrollLoss } from "./internal/scroll-loss";
export type { ScrollLoss } from "./internal/scroll-loss";

export default {
  description:
    "The dev unmount detector, the coverage net under kept-state: watchStateLoss(onLoss) follows every React commit through the page's commit bridge (each state hook's baseline — its value before the user touched it; a change no user input caused moves it) and, when a page-level place (an outermost KeepScope: a tab's app, the global action bar) unmounts without being closed, walks its fibers and reports each useState / useReducer the user changed that is neither kept (useKept / useDraft) nor marked useTransient(\"<why>\") — state a remount, so a reload, throws away. watchScrollLoss(onLoss) is its twin for state that lives only in the DOM: once a <Scroll> the user scrolled settles, it reports a pane's main scroller (at least half the pane's height) away from its top that nothing keeps — no keep mark from useScrollAcrossReload / PaneScroll / a persisting useStickyScroll, not transient by its own say, not a follower at its bottom (auto-scroll's scroller marks). reports/reload-loss files both.",
  contributions: [],
} satisfies PluginDefinition;
