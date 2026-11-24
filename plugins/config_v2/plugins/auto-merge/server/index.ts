import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import {
  acknowledgeAutoMerge,
  resolveAutoMergeField,
  undoAutoMerge,
} from "../core";
import {
  handleAcknowledgeAutoMerge,
  handleResolveAutoMergeField,
  handleUndoAutoMerge,
} from "./internal/handlers";
import {
  configAutoMergeServed,
  configAutoMergesServed,
  followDocuments,
  stopFollowingDocuments,
} from "./internal/served";
import { autoMergeNotifyWarmup } from "./internal/notify";

export { listAutoMerges } from "./internal/list";

export default {
  description:
    "Serves the automatic-merge records the config registry writes when an update's new defaults merge cleanly under a user override: config-v2.auto-merges (every document with one) and config-v2.auto-merge (one document's record and where it stands — current, superseded, edited since), moved with the registry's document fan-out; and POST /api/config-v2/auto-merge/undo (put the normal conflict back) /ack (dismiss the note — Mark reviewed) and /resolve-field (the developer review's Keep / Use mine / Use new default on one field); and the config-auto-merge.notify warm-up, which writes ONE user notification (category updates, action config-auto-merge — Undo) for every merge record no notification announced yet, each then stamped notified.",
  contributions: [
    ...configAutoMergesServed.declare,
    ...configAutoMergeServed.declare,
  ],
  httpRoutes: {
    [undoAutoMerge.route]: handleUndoAutoMerge,
    [acknowledgeAutoMerge.route]: handleAcknowledgeAutoMerge,
    [resolveAutoMergeField.route]: handleResolveAutoMergeField,
  },
  register: [autoMergeNotifyWarmup],
  onReady() {
    followDocuments();
  },
  onShutdown() {
    stopFollowingDocuments();
  },
} satisfies ServerPluginDefinition;
