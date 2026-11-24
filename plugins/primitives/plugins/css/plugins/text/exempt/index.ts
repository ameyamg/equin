import type { Exemptions } from "@plugins/framework/plugins/tooling/plugins/exempt/core";

export default [
  {
    rule: "line/no-raw-single-line-provider",
    paths: ["exhibits/internal/text-exhibits.tsx"],
    kind: "sanctioned",
    reason:
      "Text reads the single-line contract: its exhibits set it directly to show both sides.",
  },
] satisfies Exemptions;
