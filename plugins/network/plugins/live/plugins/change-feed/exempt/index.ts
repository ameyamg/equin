import type { Exemptions } from "@plugins/framework/plugins/tooling/plugins/exempt/core";

export default [
  {
    rule: "deadline/no-unstated-wall-age",
    paths: ["server/internal/route-span.ts"],
    kind: "debt",
    task: "task-1795393483-05t4rq",
    reason:
      "sinceChangeMs ages a Postgres commit's wall instant on the wall clock, so a sleep before delivery reads as latency; machine-sleep is out of reach without a plugin cycle.",
  },
] satisfies Exemptions;
