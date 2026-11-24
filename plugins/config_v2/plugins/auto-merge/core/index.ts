export {
  autoMergeSummarySchema,
  autoMergeStateSchema,
  configAutoMerge,
  configAutoMerges,
} from "./internal/resources";
export type {
  AutoMergeStateView,
  AutoMergeSummary,
} from "./internal/resources";
export {
  acknowledgeAutoMerge,
  resolveAutoMergeField,
  undoAutoMerge,
} from "./internal/endpoints";
export {
  AUTO_MERGE_ACTION_KIND,
  AUTO_MERGE_NOTIFICATION_TYPE,
  autoMergeDescription,
  autoMergePayloadSchema,
  configDisplayName,
} from "./internal/notification";
export type { AutoMergePayload } from "./internal/notification";
export { placementNotes, placementSummary } from "./internal/placement-text";
