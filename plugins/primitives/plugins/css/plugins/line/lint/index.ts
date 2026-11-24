import noRawSingleLineProvider from "./no-raw-single-line-provider";
import type { LintContribution } from "@plugins/framework/plugins/tooling/plugins/lint/core";

/**
 * Lint barrel for the line rules. `no-raw-single-line-provider`: the ambient
 * single-line provider is the layout primitives' building block, not an app's —
 * an app wraps its line in `<Line>`. The primitives that implement a container
 * declare a sanctioned exemption in their own `exempt/index.ts`.
 */
export default {
  name: "line",
  rules: {
    "no-raw-single-line-provider": noRawSingleLineProvider,
  },
} satisfies LintContribution;
