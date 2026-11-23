import { serveCollection } from "@plugins/network/plugins/live/server";
import { taskManageGrants, unownedActions } from "../../core";
import { _taskUnownedActions, tasksManageGrant } from "./tables";

/** The lookup-only grant row, served from the extension handle. */
export const taskManageGrantsServed = serveCollection(taskManageGrants, {
  from: tasksManageGrant,
});

/** The audit, over `task_unowned_actions` (every row field a column). */
export const unownedActionsServed = serveCollection(unownedActions, {
  from: _taskUnownedActions,
});
