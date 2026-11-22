import noWallClockDeadline from "./no-wall-clock-deadline";
import type { LintContribution } from "@plugins/framework/plugins/tooling/plugins/lint/core";

export default {
  name: "deadline",
  rules: {
    // A watchdog on this machine's work counts awake time: armAwakeDeadline.
    "no-wall-clock-deadline": noWallClockDeadline,
  },
  // A test may arm a raw timer to drive its own fake; generated files run nothing.
  outOfScope: {
    "no-wall-clock-deadline": ["test", "research", "generated"],
  },
} satisfies LintContribution;
