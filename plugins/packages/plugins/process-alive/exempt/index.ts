import type { Exemptions } from "@plugins/framework/plugins/tooling/plugins/exempt/core";

export default [
  {
    rule: "process-alive/no-signal-zero-probe",
    paths: ["core/internal/process-alive.ts"],
    kind: "sanctioned",
    reason:
      "The one liveness probe by definition: isProcessAlive / isProcessGroupAlive are the process.kill(_, 0) every other caller is pointed at.",
  },
] satisfies Exemptions;
