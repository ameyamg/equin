import { Attachments } from "@plugins/infra/plugins/attachments/server";
import { proposalAttachmentLinksEntityRef } from "../../core";
import { _proposals } from "./tables";

// Proposal ↔ attachment link: what keeps the files a proposal's values
// reference (imported from the agent's worktree) from the orphan sweep until
// the record that accepts them links them itself. Set once, when it arrives.
export const proposalAttachments = Attachments.defineLink(
  _proposals,
  proposalAttachmentLinksEntityRef,
);
// Re-export the underlying pgTable so drizzle-kit's schema glob picks it up.
export const _proposalAttachmentsTable = proposalAttachments.table;
