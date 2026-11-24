import type { Exemptions } from "@plugins/framework/plugins/tooling/plugins/exempt/core";

export default [
  {
    rule: "line/no-raw-single-line-provider",
    paths: ["web/internal/stack.tsx"],
    kind: "sanctioned",
    reason:
      "Stack is a flow container: a column or wrapping Stack resets the single-line contract for its children.",
  },
] satisfies Exemptions;
