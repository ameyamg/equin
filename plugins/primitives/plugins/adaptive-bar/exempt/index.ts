import type { Exemptions } from "@plugins/framework/plugins/tooling/plugins/exempt/core";

export default [
  {
    rule: "layout/no-adhoc-layout",
    paths: ["web/internal/adaptive-bar.tsx"],
    kind: "sanctioned",
    reason:
      "A layout primitive living outside `css/`: the overflow/space-sharing recipe IS the adaptive bar.",
  },
  {
    rule: "line/no-raw-single-line-provider",
    paths: ["web/internal/adaptive-bar.tsx"],
    kind: "sanctioned",
    reason:
      "AdaptiveBar implements a line container (its measured strip) and provides the single-line contract itself.",
  },
] satisfies Exemptions;
