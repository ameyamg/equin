import { defineDataViewSources } from "@plugins/primitives/plugins/data-view/web";
import type { LinkTarget } from "@plugins/primitives/plugins/link-gesture/core";

/** What the Decisions pane hands each of its sources: the selection and where a row goes. */
export interface DecisionsHostProps {
  selectedId: string | undefined;
  /** Where a row goes: a link, so middle- / ⌘-click open it in a browser tab. */
  linkTo: (id: string) => LinkTarget;
}

/**
 * The Decisions inbox's sources: one view bar over the same decisions, sliced
 * by their derived tab — Needs you, Sent, FYI, Closed.
 */
export const DecisionsSources = defineDataViewSources<DecisionsHostProps>();
