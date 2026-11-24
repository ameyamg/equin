import { defineRoute } from "@plugins/primitives/plugins/pane/core";

/** The Decisions inbox, in the agent manager. */
export const decisionsRoute = defineRoute({
  id: "decisions",
  segment: "decisions",
});

/** One decision, open beside the inbox. */
export const decisionDetailRoute = defineRoute({
  id: "decision-detail",
  segment: "decision/:decisionId",
  parent: decisionsRoute,
});
