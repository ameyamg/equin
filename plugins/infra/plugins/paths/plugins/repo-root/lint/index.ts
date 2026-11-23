import noDepthCountedPath from "./no-depth-counted-path";
import noStatfsOfRepoRoot from "./no-statfs-of-repo-root";
import type { LintContribution } from "@plugins/framework/plugins/tooling/plugins/lint/core";

export default {
  name: "repo-root",
  rules: {
    // A `../` chain from a file's own location may not leave its plugin.
    "no-depth-counted-path": noDepthCountedPath,
    // A volume read of the checkout fails in a compiled release.
    "no-statfs-of-repo-root": noStatfsOfRepoRoot,
  },
} satisfies LintContribution;
