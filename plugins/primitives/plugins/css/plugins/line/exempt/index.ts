import type { Exemptions } from "@plugins/framework/plugins/tooling/plugins/exempt/core";

export default [
  {
    rule: "line/no-raw-single-line-provider",
    paths: ["web/internal/line.tsx"],
    kind: "sanctioned",
    reason:
      "The definition site: Line is the provider plus its region-line box.",
  },
] satisfies Exemptions;
