export { proposalIdKind } from "./internal/id-kinds";
export type { ProposalId } from "./internal/id-kinds";
export {
  PROPOSAL_STATE_META,
  PROPOSAL_STATES,
  PROPOSAL_TYPE_ID_PATTERN,
  proposalFields,
  proposalsEntityRef,
  ProposalTypeIdSchema,
  ProposalValuesSchema,
} from "./internal/fields";
export type { ProposalState, ProposalValues } from "./internal/fields";
export {
  proposalAttachmentLinks,
  proposalAttachmentLinksEntityRef,
  proposalsList,
} from "./internal/live";
export type { ProposalRow } from "./internal/live";
export { acceptedSet, changedKeys, jsonEqual } from "./internal/diff";
export {
  decideProposal,
  DecideProposalBodySchema,
  importProposalAttachment,
  missingProposalAttachments,
  PROPOSAL_ATTACHMENTS_MAX,
  PROPOSAL_DELIVERIES,
  PROPOSAL_NOTE_MAX,
  ProposalOutcomeSchema,
  PROPOSALS_PER_SEND_MAX,
  receiveProposal,
  sendProposals,
} from "./internal/endpoints";
export type {
  DecideProposalBody,
  ProposalDelivery,
  ProposalOutcome,
} from "./internal/endpoints";
