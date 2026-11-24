import { serveValue } from "@plugins/network/plugins/live/server";
import {
  configRegistryReady,
  onDocumentChange,
  readAutoMerge,
} from "@plugins/config_v2/server";
import { configAutoMerge, configAutoMerges } from "../../core";
import { listAutoMerges } from "./list";

// Both are functions of the record files, which only the registry writes —
// every write ends in its document fan-out (`onDocumentChange`), which
// notifies them below.
export const configAutoMergesServed = serveValue(configAutoMerges, {
  source: "external",
  changes: "notified",
  loader: async () => {
    await configRegistryReady();
    return listAutoMerges();
  },
});

export const configAutoMergeServed = serveValue(configAutoMerge, {
  source: "external",
  changes: "notified",
  loader: async ({ path, scopeId }) => {
    await configRegistryReady();
    return readAutoMerge(path, scopeId || undefined);
  },
});

let stopListening: (() => void) | null = null;

/** Move both values with every document the registry's fan-out moves. */
export function followDocuments(): void {
  stopListening?.();
  stopListening = onDocumentChange((doc) => {
    configAutoMergeServed.notify(doc);
    configAutoMergesServed.notify();
  });
}

export function stopFollowingDocuments(): void {
  stopListening?.();
  stopListening = null;
}
