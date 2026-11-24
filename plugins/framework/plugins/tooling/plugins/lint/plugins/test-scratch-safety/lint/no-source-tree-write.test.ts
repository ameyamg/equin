/**
 * Tests for `no-source-tree-write`: a test file that writes to a path built
 * from its checkout (import.meta.dir, __dirname, a repo-root constant or
 * getter, process.cwd()) — directly or through a `const` — is reported; a
 * scratch path under tmpdir(), a checkout-relative path joined onto a temp
 * root, a read or a symlink FROM the tree, and any non-test file are not.
 */

import { createRuleTester } from "@plugins/framework/plugins/tooling/plugins/lint/core/testing";
import rule from "./no-source-tree-write";

const ruleTester = createRuleTester({ jsx: false });
const filename = "/repo/plugins/x/core/internal/x.test.ts";

ruleTester.run("no-source-tree-write", rule, {
  valid: [
    // Scratch under the run's temp root.
    `import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
     const dir = mkdtempSync(join(tmpdir(), "x-")); writeFileSync(join(dir, "a"), "");`,
    // Reading the tree.
    `import { readFileSync } from "node:fs"; import { join } from "node:path";
     readFileSync(join(import.meta.dir, "fixture.json"), "utf8");`,
    // Copying a repo file OUT, linking FROM the tree.
    `import { copyFileSync, symlinkSync, mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
     import { REPO_ROOT } from "@plugins/infra/plugins/paths/plugins/repo-root/core";
     const root = mkdtempSync(join(tmpdir(), "r-"));
     copyFileSync(join(REPO_ROOT, "mise.toml"), join(root, "mise.toml"));
     symlinkSync(join(import.meta.dir, "../scripts"), join(root, "scripts"));`,
    // A checkout-relative layout rebuilt under a temp root.
    `import { mkdirSync } from "node:fs"; import { join, relative, resolve } from "node:path";
     import { REPO_ROOT } from "@plugins/infra/plugins/paths/plugins/repo-root/core";
     const REL = relative(REPO_ROOT, resolve(import.meta.dir, ".."));
     let root = ""; mkdirSync(join(root, REL), { recursive: true });`,
    // A local variable named like a root is judged by its value.
    `import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
     const repoRoot = mkdtempSync(join(tmpdir(), "repo-")); writeFileSync(join(repoRoot, "a"), "");`,
    // A checkout path used as a NAME under a temp root, and helpers' bodies.
    `import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { basename, join } from "node:path";
     import { REPO_ROOT } from "@plugins/infra/plugins/paths/plugins/repo-root/core";
     const root = mkdtempSync(join(tmpdir(), "r-"));
     const fixture = (n: string) => readFixture(join(import.meta.dir, n));
     writeFileSync(join(root, basename(import.meta.filename)), "");
     writeFileSync(join(root, fixture("a"), String({ REPO_ROOT: 1 })), "");`,
    // Opened for reading.
    `import { openSync } from "node:fs"; import { join } from "node:path";
     openSync(join(import.meta.dir, "fixture"), "r");`,
    // Not a test file.
    {
      code: `import { writeFileSync } from "node:fs"; import { join } from "node:path";
             writeFileSync(join(import.meta.dir, "out.generated.ts"), "");`,
      filename: "/repo/plugins/x/scripts/gen.ts",
    },
  ].map((c) => (typeof c === "string" ? { code: c, filename } : c)),
  invalid: [
    // The 2026-11-24 incident: a probe dir made beside the test.
    {
      code: `import { mkdtempSync, writeFileSync } from "node:fs"; import { join } from "node:path";
             const probeDir = mkdtempSync(join(import.meta.dir, ".config-test-"));
             writeFileSync(join(probeDir, "p.ts"), "");`,
      errors: [
        { messageId: "sourceTreeWrite" },
        { messageId: "sourceTreeWrite" },
      ],
    },
    {
      code: `import { writeFileSync } from "node:fs"; import { join } from "node:path";
             import { REPO_ROOT } from "@plugins/infra/plugins/paths/plugins/repo-root/core";
             writeFileSync(join(REPO_ROOT, "tmp.json"), "{}");`,
      errors: [{ messageId: "sourceTreeWrite" }],
    },
    {
      code: `import { promises as fs } from "node:fs"; import { resolve } from "node:path";
             await fs.rm(resolve(__dirname, "out"), { recursive: true });`,
      errors: [{ messageId: "sourceTreeWrite" }],
    },
    {
      code: `import { copyFileSync } from "node:fs"; import { join } from "node:path";
             copyFileSync("/tmp/a", join(process.cwd(), "a"));`,
      errors: [{ messageId: "sourceTreeWrite" }],
    },
    {
      code: `import { getMainRepoRoot } from "@plugins/infra/plugins/spawn/core";
             await Bun.write(\`\${getMainRepoRoot()}/x.txt\`, "x");`,
      errors: [{ messageId: "sourceTreeWrite" }],
    },
    // The review's shapes: other root getters and meta props, aliases,
    // namespaces, a branch, a let set in a hook, an imported cwd, Bun.file.
    {
      code: `import { getWorktreeRoot } from "@plugins/infra/plugins/spawn/core";
             const root = await getWorktreeRoot(); writeFileSync(join(root, "x"), "");`,
      errors: [{ messageId: "sourceTreeWrite" }],
    },
    {
      code: `writeFileSync(join(dirname(import.meta.path), "x"), "");`,
      errors: [{ messageId: "sourceTreeWrite" }],
    },
    {
      code: `import { REPO_ROOT as root } from "@plugins/infra/plugins/paths/plugins/repo-root/core";
             import * as rr from "@plugins/infra/plugins/paths/plugins/repo-root/core";
             writeFileSync(join(root, "x"), ""); writeFileSync(join(rr.REPO_ROOT, "x"), "");`,
      errors: [
        { messageId: "sourceTreeWrite" },
        { messageId: "sourceTreeWrite" },
      ],
    },
    {
      code: `import { tmpdir } from "node:os";
             const dir = process.env.KEEP ? join(import.meta.dir, "out") : mkdtempSync(join(tmpdir(), "x-"));
             writeFileSync(join(dir, "a"), "");`,
      errors: [{ messageId: "sourceTreeWrite" }],
    },
    {
      code: `let dir = ""; beforeAll(() => { dir = join(import.meta.dir, ".out"); }); mkdirSync(dir);`,
      errors: [{ messageId: "sourceTreeWrite" }],
    },
    {
      code: `import { cwd } from "node:process"; const { dir } = import.meta;
             writeFileSync(join(cwd(), "x"), ""); writeFileSync(\`\${dir}/y\`, "");`,
      errors: [
        { messageId: "sourceTreeWrite" },
        { messageId: "sourceTreeWrite" },
      ],
    },
    {
      code: `await Bun.file(join(import.meta.dir, "x")).write("x"); openSync(new URL("./y", import.meta.url), "w");`,
      errors: [
        { messageId: "sourceTreeWrite" },
        { messageId: "sourceTreeWrite" },
      ],
    },
    // A testing/ fixture is test code too.
    {
      code: `import { mkdirSync } from "node:fs"; import { join } from "node:path";
             mkdirSync(join(import.meta.dirname, "fixtures-out"));`,
      filename: "/repo/plugins/x/core/testing/fixture.ts",
      errors: [{ messageId: "sourceTreeWrite" }],
    },
  ].map((c) => ({ filename, ...c })),
});
