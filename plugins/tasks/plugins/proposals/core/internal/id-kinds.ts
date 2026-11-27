import { defineIdKind, type IdOf } from "@plugins/ids/core";

/** A proposal (`proposals.id`), minted on main when an agent's proposal arrives. */
export const proposalIdKind = defineIdKind({
  prefix: "prp",
  label: "Proposal",
});
export type ProposalId = IdOf<typeof proposalIdKind>;
