import noRawDateFormat from "./no-raw-date-format";
import type { LintContribution } from "@plugins/framework/plugins/tooling/plugins/lint/core";

export default {
  name: "date-format",
  rules: {
    "no-raw-date-format": noRawDateFormat,
  },
  // A script, bin or e2e flow prints for the agent running it, not for the
  // user's screen: its dates need no setting.
  outOfScope: { "no-raw-date-format": ["e2e", "script", "bin", "research"] },
} satisfies LintContribution;
