import { ExcludeFromFork } from "@plugins/database/plugins/admin/server";
import { markCascadeBounded } from "@plugins/infra/plugins/retention/server";
import { _mailDrafts } from "./tables";
import { _mailDraftAttachmentsTable } from "./schema-attachments";

// A draft's links go with it.
markCascadeBounded(_mailDraftAttachmentsTable, _mailDrafts);

export const draftTableExclusions = [
  ExcludeFromFork({
    table: _mailDrafts,
    reason:
      "Mail drafts and the outbox: a worktree forked from main must never send main's queued mail or rewrite main's provider drafts.",
  }),
  ExcludeFromFork({
    table: _mailDraftAttachmentsTable,
    reason: "the links of mail_drafts, which forks leave out",
  }),
];
