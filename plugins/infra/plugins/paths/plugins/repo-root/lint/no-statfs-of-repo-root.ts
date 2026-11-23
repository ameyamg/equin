import { lintRuleCreator } from "@plugins/framework/plugins/tooling/plugins/lint/core";
import type { TSESTree } from "@typescript-eslint/utils";

const createRule = lintRuleCreator(import.meta.url);

/** The volume reads: `statfs` / `statfsSync`, bare or as `fs.statfs`. */
const STATFS = new Set(["statfs", "statfsSync"]);

function calleeName(callee: TSESTree.Node): string | null {
  if (callee.type === "Identifier") return callee.name;
  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier"
  )
    return callee.property.name;
  return null;
}

/** Whether `node` mentions the identifier `REPO_ROOT` anywhere inside it. */
function mentionsRepoRoot(node: TSESTree.Node): boolean {
  if (node.type === "Identifier") return node.name === "REPO_ROOT";
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent") continue;
    const children: unknown[] = Array.isArray(value) ? value : [value];
    for (const child of children) {
      if (
        typeof child === "object" &&
        child !== null &&
        typeof (child as { type?: unknown }).type === "string" &&
        mentionsRepoRoot(child as TSESTree.Node)
      )
        return true;
    }
  }
  return false;
}

/**
 * A volume read (`statfs`) of a path built from `REPO_ROOT`. The checkout is
 * where the CODE comes from, not a disk the app fills: in a released backend
 * (a `bun build --compile` binary) `REPO_ROOT` is the virtual `/$bunfs/root`,
 * which statfs answers with ENOENT — the box-link heartbeat failed every beat
 * that way (report-1795392900-wipr4k). The disk worth measuring is the data
 * root's (`dataRoot()`, `@plugins/infra/plugins/paths/core`).
 */
export default createRule({
  name: "no-statfs-of-repo-root",
  meta: {
    type: "problem",
    docs: {
      description:
        "statfs of a REPO_ROOT path fails in a compiled release (/$bunfs/root); measure the data root's volume instead.",
    },
    schema: [],
    messages: {
      repoRootVolume:
        "This reads the volume of a `REPO_ROOT` path. In a released backend (a `bun build --compile` binary) `REPO_ROOT` is the virtual `/$bunfs/root`, and statfs throws ENOENT. Measure the disk the app fills — `dataRoot()` from `@plugins/infra/plugins/paths/core` — instead.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        const name = calleeName(node.callee);
        if (name === null || !STATFS.has(name)) return;
        const arg = node.arguments[0];
        if (arg !== undefined && mentionsRepoRoot(arg)) {
          context.report({ node, messageId: "repoRootVolume" });
        }
      },
    };
  },
});
