import type { Exemptions } from "@plugins/framework/plugins/tooling/plugins/exempt/core";

export default [
  {
    rule: "timer/no-unlisted-timer",
    paths: ["server/internal/sync.ts"],
    kind: "sanctioned",
    reason:
      "Real polling with no change signal to replace it here: the mail provider (Gmail without Pub/Sub push) signals nothing, so a 30 s history read runs only while a mail view is subscribed (whileSubscribed). Push (design step 8) will not retire it: worktrees never consume the push subscription and Google says push may drop notifications. With nobody watching, a scheduled job (mail.sync-idle) does it instead.",
  },
] satisfies Exemptions;
