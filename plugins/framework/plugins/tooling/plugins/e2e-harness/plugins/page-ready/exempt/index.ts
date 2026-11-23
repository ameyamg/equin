import type { Exemptions } from "@plugins/framework/plugins/tooling/plugins/exempt/core";

export default [
  {
    rule: "box-presence/no-raw-box-presence",
    paths: ["core/internal/busy.ts"],
    kind: "sanctioned",
    reason:
      "The read runs inside the driven page (Playwright evaluateAll), a real browser with a layout engine, where no app module can be imported.",
  },
] satisfies Exemptions;
