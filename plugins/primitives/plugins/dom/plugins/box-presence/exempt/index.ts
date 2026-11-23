import type { Exemptions } from "@plugins/framework/plugins/tooling/plugins/exempt/core";

export default [
  {
    rule: "box-presence/no-raw-box-presence",
    paths: ["web/internal/generates-box.ts"],
    kind: "sanctioned",
    reason:
      "The box-presence primitive is the one sanctioned home for the read.",
  },
] satisfies Exemptions;
