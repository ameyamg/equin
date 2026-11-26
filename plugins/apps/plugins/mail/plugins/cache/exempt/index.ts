import type { Exemptions } from "@plugins/framework/plugins/tooling/plugins/exempt/core";

export default [
  {
    rule: "timer/no-unlisted-timer",
    paths: ["server/internal/sync.ts"],
    kind: "sanctioned",
    reason:
      "Real polling where no change signal exists: before Gmail push (Pub/Sub) is set up, in a worktree that has not set it up, and while push is down, the provider signals nothing, so a 30 s history read runs only while a mail view is subscribed (whileSubscribed) and push is not live (served.ts' reconcileTick stops it once push is live). With nobody watching, a scheduled job (mail.sync-idle) does it instead.",
  },
] satisfies Exemptions;
