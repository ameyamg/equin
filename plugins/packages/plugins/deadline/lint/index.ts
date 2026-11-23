import noUnstatedWallAge from "./no-unstated-wall-age";
import noWallClockDeadline from "./no-wall-clock-deadline";
import type { LintContribution } from "@plugins/framework/plugins/tooling/plugins/lint/core";

export default {
  name: "deadline",
  rules: {
    // A watchdog on this machine's work counts awake time: armAwakeDeadline.
    "no-wall-clock-deadline": noWallClockDeadline,
    // An age or deadline check states its clock: awake time, or wallNow(reason).
    "no-unstated-wall-age": noUnstatedWallAge,
  },
  // A test may arm a raw timer to drive its own fake; generated files run nothing.
  outOfScope: {
    "no-wall-clock-deadline": ["test", "research", "generated"],
    "no-unstated-wall-age": ["test", "research", "generated"],
  },
} satisfies LintContribution;
