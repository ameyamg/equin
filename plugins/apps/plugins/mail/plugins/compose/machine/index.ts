import type { MachinePluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { ExcludeFromFork } from "@plugins/database/plugins/admin/server";
import { _mailDraftAttachmentsTable, _mailDrafts } from "../server";

export default {
  description:
    "The Mail app's compose, desktop half: mail_drafts and its attachment links left out of worktree DB forks (a fork must never send main's queued mail) — the computer's database admin, which a browser host has none of.",
  contributions: [
    ExcludeFromFork({
      table: _mailDrafts,
      reason:
        "Mail drafts and the outbox: a worktree forked from main must never send main's queued mail or rewrite main's provider drafts.",
    }),
    ExcludeFromFork({
      table: _mailDraftAttachmentsTable,
      reason: "the links of mail_drafts, which forks leave out",
    }),
  ],
} satisfies MachinePluginDefinition;
