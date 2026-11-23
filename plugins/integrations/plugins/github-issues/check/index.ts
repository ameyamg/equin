import { join } from "node:path";
import type { Check } from "@plugins/framework/plugins/tooling/core";
import { readdir, readFile } from "@plugins/packages/plugins/timed-fs/core";
import { getWorktreeRoot } from "@plugins/infra/plugins/spawn/core";
// Own-plugin, so relative.
import {
  ISSUE_TEMPLATES,
  ISSUE_TEMPLATE_DIR,
  issueTemplateFile,
} from "../core/issue-templates";

/**
 * `.github/ISSUE_TEMPLATE/` holds exactly the templates `ISSUE_TEMPLATES`
 * declares, each byte for byte as `issueTemplateFile` renders it. A link
 * naming a template GitHub does not have opens a blank form, unlabelled — the
 * exact failure the templates exist to prevent — and nothing else would see it.
 */
const check: Check = {
  id: "templates-in-sync",
  inputKeyed: true,
  description: `${ISSUE_TEMPLATE_DIR}/ holds exactly the issue templates github-issues' ISSUE_TEMPLATES declares, as it renders them`,
  async run() {
    const dir = join(await getWorktreeRoot(), ISSUE_TEMPLATE_DIR);
    const want = new Map<string, string>(
      Object.values(ISSUE_TEMPLATES).map((t) => [t.file, issueTemplateFile(t)]),
    );
    const problems: string[] = [];
    const present = new Set(await readdir(dir));
    for (const [file, text] of want) {
      if (!present.has(file)) problems.push(`${file}: missing`);
      else if ((await readFile(join(dir, file), "utf8")) !== text)
        problems.push(`${file}: differs from what ISSUE_TEMPLATES renders`);
    }
    for (const file of present)
      if (!want.has(file)) problems.push(`${file}: not in ISSUE_TEMPLATES`);
    if (problems.length === 0) return { ok: true };
    return {
      ok: false,
      message: `${ISSUE_TEMPLATE_DIR}/ is out of sync:\n    ${problems.join("\n    ")}`,
      hint: `Edit ISSUE_TEMPLATES (plugins/integrations/plugins/github-issues/core/issue-templates.ts), never the files, and write each file as issueTemplateFile renders it.`,
    };
  },
};

export default check;
