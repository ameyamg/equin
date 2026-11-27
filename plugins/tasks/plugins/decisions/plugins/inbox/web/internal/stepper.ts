import { defineListStepper } from "@plugins/primitives/plugins/data-view/plugins/list/web";

/**
 * The decisions list's step (j / k), shared with the open decision's pane:
 * answering it there (a pick, Enter in the note) opens the next decision of
 * the list, as `j` would.
 */
export const decisionsStepper = defineListStepper("tasks.decisions.inbox");
