import type { Exemptions } from "@plugins/framework/plugins/tooling/plugins/exempt/core";

export default [
  {
    rule: "deadline/no-unstated-wall-age",
    paths: ["cli/internal/holder.ts"],
    kind: "debt",
    task: "task-1795393486-gwkmk5",
    reason:
      "The holder stall verdict ages another process's op-log wall instants on the wall clock, so a sleep reads as a stalled holder.",
  },
] satisfies Exemptions;
