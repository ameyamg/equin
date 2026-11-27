import type { MachinePluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { decideProposal } from "../core";
import { handleDecideProposal } from "./internal/decide";

export default {
  description:
    "Deciding on an agent's proposal: POST /api/proposals/:id/decide (owner only) — accept (only the keys the proposal changed, written over main's record through the type's own write path; or the user's edited copy; a new record created under the worktree's id), reject, or request changes with a note — then the decision typed into the author's task as a <proposal-decision> event turn (deliverEventTurn, ifClosed reopen: a stopped agent resumed, a closed one reopened, the note — prompt-editor markdown — resolved for it with its attachments).",
  httpRoutes: {
    [decideProposal.route]: handleDecideProposal,
  },
} satisfies MachinePluginDefinition;
