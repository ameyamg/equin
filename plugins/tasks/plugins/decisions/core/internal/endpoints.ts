import { defineEndpoint } from "@plugins/infra/plugins/endpoints/core";

/**
 * The user opened a decision: stamps its `seen_at` with now, which clears its
 * "new" mark until the agent writes in its thread again (`isNew` on
 * `decisionsList`). Owner access; a decision that does not exist is a 404.
 */
export const markDecisionSeenEndpoint = defineEndpoint({
  route: "POST /api/decisions/:decisionId/seen",
});
