import { useLive } from "@plugins/network/plugins/live/web";
import { proposalsList } from "../../core";
import { ANSWERABLE_STATES } from "./answerable";

/**
 * The proposals of one record type's scope the user may still answer (open,
 * or back with the agent), newest first — read live, for the view that owns
 * those records: its Proposal column and its opened record.
 */
export function useOpenProposals(type: string, scope: string) {
  return useLive(proposalsList, {
    where: { type, scope, state: { in: [...ANSWERABLE_STATES] } },
    limit: 200,
  });
}
