export { tasksManageUnowned } from "./internal/capability";
export {
  taskManageGrantShape,
  TaskManageGrantRowSchema,
  taskManageGrants,
  unownedActionIdKind,
  unownedActionFields,
  unownedActionsEntityRef,
  unownedActions,
} from "./internal/resources";
export type {
  TaskManageGrantRow,
  UnownedAction,
  UnownedActionId,
} from "./internal/resources";
export {
  deleteTaskManageGrant,
  putTaskManageGrant,
} from "./internal/endpoints";
