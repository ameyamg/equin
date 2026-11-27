import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { rawEndpointHandler } from "@plugins/infra/plugins/endpoints/server";
import { IdKinds } from "@plugins/ids/server";
import {
  importProposalAttachment,
  missingProposalAttachments,
  proposalIdKind,
  receiveProposal,
  sendProposals,
} from "../core";
import {
  handleImportProposalAttachment,
  handleMissingProposalAttachments,
} from "./internal/attachments";
import { handleReceiveProposal } from "./internal/receive";
import { handleSendProposals } from "./internal/send";
import { proposalsServedContributions } from "./internal/served";

export { Proposals } from "./internal/registry";
export type {
  ProposalApplied,
  ProposalRecord,
  ProposalTarget,
  ProposalType,
} from "./internal/registry";

export default {
  description:
    "Record proposals, the record and the hand-off: the Proposals.Type registry an owner plugin registers a record type into (its fields per scope, how to read one record of this database, which ones it wrote since a time, and how to apply values through the owner's own write path); the proposals table on main (one revision of one record from one agent's task: main's record as the base, the proposed values, the changed keys, the agent's note, open / accepted / rejected / changes-requested / superseded) and its attachment links, served live as proposals.list; POST /api/proposals/send on an agent's worktree (what `./equin propose` calls: every registered record this fork wrote since it was forked, its missing files streamed to main first, then the record), and main's side of it — POST /api/proposals/incoming (diffed against main's record, a new revision superseding the task's open one) and the attachment missing / import routes, declared agentWrite: proposal (a stored proposal the user reviews before anything changes).",
  httpRoutes: {
    [sendProposals.route]: handleSendProposals,
    [receiveProposal.route]: handleReceiveProposal,
    [missingProposalAttachments.route]: handleMissingProposalAttachments,
    [importProposalAttachment.route]: rawEndpointHandler(
      importProposalAttachment,
      handleImportProposalAttachment,
    ),
  },
  contributions: [
    IdKinds.Kind({ kind: proposalIdKind }),
    ...proposalsServedContributions,
  ],
} satisfies ServerPluginDefinition;
