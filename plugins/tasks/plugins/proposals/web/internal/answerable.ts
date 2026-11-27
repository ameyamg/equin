import type { ProposalState } from "../../core";

/** The states the user may still answer — what the Proposed tab lists. */
export const ANSWERABLE_STATES = [
  "open",
  "changes-requested",
] as const satisfies readonly ProposalState[];
