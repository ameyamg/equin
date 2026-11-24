import noSourceTreeWrite from "./no-source-tree-write";
import type { LintContribution } from "@plugins/framework/plugins/tooling/plugins/lint/core";

export default {
  name: "test-scratch-safety",
  rules: { "no-source-tree-write": noSourceTreeWrite },
  // The rule exists for test code alone — the `test` category every
  // contributed rule is off in by default. It returns early on any other
  // file (a codegen step writing its own output is not a test).
  enforceEverywhere: ["no-source-tree-write"],
} satisfies LintContribution;
