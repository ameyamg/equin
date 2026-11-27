import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { IdKinds } from "@plugins/ids/web";
import { proposalIdKind } from "../core";

export { ProposalChip } from "./components/proposal-chip";
export { ProposalReview } from "./components/proposal-review";
export type {
  ProposalCurrent,
  ProposalReviewProps,
} from "./components/proposal-review";
export { ProposalsDataView } from "./components/proposals-data-view";
export { useOpenProposals } from "./internal/use-proposals";

export default {
  description:
    "Record proposals, the review pieces an owner view embeds where its records are shown: useOpenProposals(type, scope) — the proposals the user may still answer, read live; ProposalsDataView — them as a DataView (the owner's Proposed tab; a proposed new record its own row; the owner adds columns over the proposed values); ProposalChip — the Proposed / Changes requested chip for the owner's row; and ProposalReview — one proposal in the opened record: who proposed it and why, the changed fields, warnings when the record moved on main, the record now beside the record after accepting (drawn by the owner's preview, else the changed fields as text), and Accept / Edit then accept (the owner's FieldsForm over a copy) / Request changes (a note the agent gets) / Reject. Registers the prp id kind.",
  contributions: [IdKinds.Kind({ kind: proposalIdKind })],
} satisfies PluginDefinition;
