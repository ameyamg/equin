import noImportedJobRegister from "./no-imported-job-register";
import type { LintContribution } from "@plugins/framework/plugins/tooling/plugins/lint/core";

export default {
  name: "jobs",
  rules: {
    // An imported job is registered by its plugin's `register` list only.
    "no-imported-job-register": noImportedJobRegister,
  },
} satisfies LintContribution;
