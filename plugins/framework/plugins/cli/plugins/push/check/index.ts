import { join } from "node:path";
import { readFileSync } from "@plugins/packages/plugins/timed-fs/core";
import type { Check } from "@plugins/framework/plugins/tooling/core";
import {
  WRAPPER_FILE,
  STUB_SCRIPT,
  stubFindings,
  wrapperFindings,
} from "./rebase-first-stub";

const check: Check = {
  id: "push:rebase-first-stub",
  description:
    "`./equin` runs push's pre-rebase stub before anything else, and the stub reaches nothing but git and sh — the only part of a push that runs a branch's old code before the rebase stays that small",
  async run(ctx) {
    const { root } = await ctx.repo();
    const findings = [
      ...wrapperFindings(readFileSync(join(root, WRAPPER_FILE), "utf8")),
      ...stubFindings(readFileSync(join(root, STUB_SCRIPT), "utf8")),
    ];
    if (findings.length === 0) return { ok: true };
    return {
      ok: false,
      message: findings.join("\n"),
      hint:
        "The stub runs on a branch's OLD copy before that branch is rebased onto main, so whatever it depends on must be something main never changes: git and POSIX sh. " +
        "Do the work in the push driver (cli/run.ts) instead — it runs on main's code once the stub has rebased. See the push CLAUDE.md, § Rebase first.",
    };
  },
};

export default check;
