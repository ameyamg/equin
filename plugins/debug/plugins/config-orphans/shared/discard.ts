import { z } from "zod";
import { defineEndpoint } from "@plugins/infra/plugins/endpoints/core";

/**
 * Discard one orphaned config: remove every file the audit lists for it
 * (overrides, origins, ancestors, merge records — base and `@app/<id>` scopes)
 * from the served config generation, through the config store. Refused (409)
 * unless the audit still finds it orphaned: a config a live descriptor reads is
 * never removed here. The user layer is not versioned, so the caller confirms
 * first.
 */
export const discardConfigOrphanEndpoint = defineEndpoint({
  route: "POST /api/config-orphans/discard",
  body: z.object({ storeKey: z.string().min(1) }),
  response: z.object({ removed: z.array(z.string()) }),
  needsMachine: { feature: "Discarding saved settings on this machine" },
  // Its writes go through the config store's agent-write ledger, so an
  // automated session's discard is put back afterwards like any config write.
  agentReverted: true,
});
