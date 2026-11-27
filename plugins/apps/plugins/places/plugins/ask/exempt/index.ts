import type { Exemptions } from "@plugins/framework/plugins/tooling/plugins/exempt/core";

export default [
  {
    rule: "date-format/no-raw-date-format",
    paths: ["machine/internal/instructions.ts"],
    kind: "sanctioned",
    reason:
      "Not display: the wall-clock time is written into the model's instructions (an LLM prompt), in one fixed unambiguous spelling the user never reads.",
  },
] satisfies Exemptions;
