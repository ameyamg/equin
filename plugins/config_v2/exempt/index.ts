import type { Exemptions } from "@plugins/framework/plugins/tooling/plugins/exempt/core";

export default [
  {
    rule: "check-thread-safety/no-blocking-check-work",
    paths: ["check/overrides-authored.ts"],
    kind: "debt",
    task: "task-1793375830-dv7cez",
    reason:
      "Per-file synchronous work on the shared check thread (a blocking fs/process call made per item, or a direct maskSource / createSourceFile) that predates the rule; move it onto ctx.repo() / fs/promises and checks/core's maskedSource / parsedTsSource.",
  },
  {
    rule: "relocate:moved-plugins-unnamed",
    paths: ["core/internal/merge/merge-corpus.json"],
    kind: "sanctioned",
    reason:
      "The merge corpus is a verbatim record of config documents from git history: it names the plugin ids they held at the time, and rewriting them would no longer be what was merged.",
  },
] satisfies Exemptions;
