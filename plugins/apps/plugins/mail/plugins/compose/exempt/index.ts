import type { Exemptions } from "@plugins/framework/plugins/tooling/plugins/exempt/core";

export default [
  {
    rule: "no-db-backed-notify",
    paths: ["server/internal/served.ts"],
    kind: "sanctioned",
    reason:
      "mail.signature is a snapshot (load: \"snapshot\"): read when an editor opens, never notified and never kept fresh by a change source (the provider's send-as settings have none; the message built reads them again). Its truth is the provider's; the one Postgres read is the account's address (mailCache.sender, the cache's mail_accounts row), which only picks whose settings to ask. Nothing a write does needs to reach an editor already open.",
  },
] satisfies Exemptions;
