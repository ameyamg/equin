import noSignalZeroProbe from "./no-signal-zero-probe";
import type { LintContribution } from "@plugins/framework/plugins/tooling/plugins/lint/core";

export default {
  name: "process-alive",
  rules: {
    // "Is this pid alive" is isProcessAlive / isProcessGroupAlive.
    "no-signal-zero-probe": noSignalZeroProbe,
  },
  // A test may probe raw to assert what the kernel answers (a zombie group's
  // EPERM); generated files run nothing.
  outOfScope: {
    "no-signal-zero-probe": ["test", "research", "generated"],
  },
} satisfies LintContribution;
