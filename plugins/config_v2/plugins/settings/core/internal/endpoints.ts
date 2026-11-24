import { z } from "zod";
import { defineEndpoint } from "@plugins/infra/plugins/endpoints/core";

/**
 * Restore ONE field to what the repo commits — the propagated git layer (the
 * generated origin ⊕ any committed authored override), not `descriptor.defaults`.
 * Deletes the whole override document when the reset leaves it saying nothing the
 * origin doesn't already say. The whole-config twin is `deleteOverride`.
 */
export const resetConfigField = defineEndpoint({
  route: "POST /api/config-v2/reset-field",
  agentReverted: true,
  body: z.object({
    storePath: z.string(),
    key: z.string(),
    scopeId: z.string().optional(),
  }),
});

export const acknowledgeConflict = defineEndpoint({
  route: "POST /api/config-v2/acknowledge-conflict",
  agentReverted: true,
  body: z.object({ storePath: z.string(), scopeId: z.string().optional() }),
});

export const deleteOverride = defineEndpoint({
  route: "POST /api/config-v2/delete-override",
  agentReverted: true,
  body: z.object({ storePath: z.string(), scopeId: z.string().optional() }),
});

// Three-way merge resolution for a hash conflict (`mergeConfigDocument`).
// `resolved` is true when the merge decided everything and the conflict is
// cleared; otherwise nothing is written and `conflictKeys` names the fields it
// could not decide.
export const mergeConflict = defineEndpoint({
  route: "POST /api/config-v2/merge-conflict",
  agentReverted: true,
  body: z.object({ storePath: z.string(), scopeId: z.string().optional() }),
  response: z.object({
    resolved: z.boolean(),
    conflictKeys: z.array(z.string()),
  }),
});
