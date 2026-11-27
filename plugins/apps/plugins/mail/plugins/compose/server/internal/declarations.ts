import { markCascadeBounded } from "@plugins/infra/plugins/retention/server";
import { _mailDrafts } from "./tables";
import { _mailDraftAttachmentsTable } from "./schema-attachments";

// A draft's links go with it. (Both tables are left out of worktree forks:
// the computer's database admin, declared in machine/.)
markCascadeBounded(_mailDraftAttachmentsTable, _mailDrafts);
