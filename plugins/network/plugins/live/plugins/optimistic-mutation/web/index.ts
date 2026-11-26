import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";

export { useOptimisticResource } from "./internal/use-optimistic-resource";
export type {
  OptimisticOptions,
  OptimisticResult,
  OptimisticSettled,
} from "./internal/use-optimistic-resource";
export { useAwaitResourceWrite } from "./internal/await-resource-write";
export type { AwaitResourceWrite } from "./internal/await-resource-write";
export { OpNoLongerApplies } from "./internal/overlay";
export { writeRows } from "./internal/row-write";
export type { RowWrite } from "./internal/row-write";
export {
  enqueueResourceWrite,
  enqueueDetachedWrite,
} from "./internal/lane-writes";

export default {
  description:
    "Optimistic-mutation primitive over live-state: useOptimisticResource replays pending ops on server truth (overlay/replay) under the never-revert policy — causal (ack-watermark) and content-based confirmation, denial only under causal proof, keep-rendered transient failures with reconnect auto-retry, and permanent (4xx) rejections dropped and reported. writeRows predicts a write on rows of a collection read through windows: every read draws it at once (the row changed, or gone from each window whose filter it no longer matches), ordered on the collection's send lane, giving way to the server's rows once acked, dropped and rethrown when rejected.",
  contributions: [],
} satisfies PluginDefinition;
