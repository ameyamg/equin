import { ExcludeFromFork } from "@plugins/database/plugins/admin/server";
import { ExcludeFromChangeFeed } from "@plugins/network/plugins/live/plugins/change-feed/server";
import { _mailGmailPush } from "../tables";

export const pushTableExclusions = [
  ExcludeFromFork({
    table: _mailGmailPush,
    reason:
      "Gmail push is per backend: a worktree consumes it only once set up from it (its own subscription), never through main's.",
  }),
  ExcludeFromChangeFeed({
    table: _mailGmailPush,
    reason:
      "Only the push module writes it, and it notifies mail.gmail-push itself (external arm).",
  }),
];
