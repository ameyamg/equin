import type { LintContribution } from "@plugins/framework/plugins/tooling/plugins/lint/core";
import noRawBoxPresence from "./no-raw-box-presence";

export default {
  name: "box-presence",
  rules: { "no-raw-box-presence": noRawBoxPresence },
} satisfies LintContribution;
