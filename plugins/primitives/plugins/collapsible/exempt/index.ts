import type { Exemptions } from "@plugins/framework/plugins/tooling/plugins/exempt/core";

export default [
  {
    rule: "line/no-raw-single-line-provider",
    paths: ["web/internal/collapsible.tsx"],
    kind: "sanctioned",
    reason:
      "Collapsible's header is a line container this primitive implements.",
  },
] satisfies Exemptions;
