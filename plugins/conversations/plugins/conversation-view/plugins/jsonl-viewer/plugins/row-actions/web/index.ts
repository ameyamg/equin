import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { JsonlRowActions as JsonlRowActionsSlots } from "./slots";

export { JsonlRowActions } from "./slots";
export type {
  RowAction,
  RowActionContribution,
  RowActionElement,
} from "./slots";
export { rowAction } from "./internal/row-action-view";
export {
  EventActionProvider,
  EventRowActions,
} from "./internal/event-action-context";
export { useCopyAction } from "./internal/use-copy-action";

export default {
  description:
    "Owns WHICH actions a JSONL transcript row carries: the JsonlRowActions.Item slot, the per-event context, and rowAction — the one renderer that draws every action (a contribution's component returns rowAction({ icon, label, onClick | popup }); the branded return type makes drawing its own button a type error). The cluster itself (reveal, guards, popup-hold) is primitives/row-actions, which EventRowActions wraps. Sits below collapsible-card so card chrome can host the strip without a cycle.",
  contributions: [],
  slots: JsonlRowActionsSlots,
} satisfies PluginDefinition;
