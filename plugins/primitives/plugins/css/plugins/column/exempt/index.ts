import type { Exemptions } from "@plugins/framework/plugins/tooling/plugins/exempt/core";

export default [
  {
    rule: "line/no-raw-single-line-provider",
    paths: ["web/internal/column.tsx"],
    kind: "sanctioned",
    reason:
      "Column is a flow container: it resets the single-line contract for its children.",
  },
] satisfies Exemptions;
