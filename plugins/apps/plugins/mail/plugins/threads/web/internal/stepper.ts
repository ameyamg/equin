import { defineListStepper } from "@plugins/primitives/plugins/data-view/plugins/list/web";

/**
 * The threads list's step (j / k), shared with the open thread's pane: Done
 * and Delete there open the next thread of the list, as `j` would.
 */
export const mailThreadsStepper = defineListStepper("mail.threads");
