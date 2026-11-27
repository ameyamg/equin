import type { Exemptions } from "@plugins/framework/plugins/tooling/plugins/exempt/core";

export default [
  {
    rule: "endpoints/no-raw-content-disposition",
    paths: ["server/internal/content.ts", "scripts/attachment-probe.ts"],
    kind: "sanctioned",
    reason:
      "A MIME parser: it READS each part's Content-Disposition header from a Gmail message (attachment vs inline) and never sends the header, so contentDisposition() (a header builder for responses) does not apply. The attachment probe reads the same header off real messages to measure what the list's attachment flag can know.",
  },
] satisfies Exemptions;
