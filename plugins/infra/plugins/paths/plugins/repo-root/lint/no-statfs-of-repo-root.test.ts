import rule from "./no-statfs-of-repo-root";
import { createRuleTester } from "@plugins/framework/plugins/tooling/plugins/lint/core/testing";

const ruleTester = createRuleTester();

const bad = (code: string) => ({
  code,
  errors: [{ messageId: "repoRootVolume" as const }],
});

ruleTester.run("no-statfs-of-repo-root", rule, {
  valid: [
    { code: `statfs(dataRoot());` },
    { code: `fs.statfsSync(path);` },
    // Other reads of a REPO_ROOT path are not this rule's.
    { code: `stat(join(REPO_ROOT, "package.json"));` },
  ],
  invalid: [
    bad(`statfs(REPO_ROOT);`),
    bad(`statfsSync(REPO_ROOT);`),
    bad(`fs.statfs(join(REPO_ROOT, "x"));`),
    bad(`await statfs(\`\${REPO_ROOT}/data\`);`),
  ],
});
