import { isTestCodePath } from "@plugins/framework/plugins/plugin-id/core";
import { lintRuleCreator } from "@plugins/framework/plugins/tooling/plugins/lint/core";
import {
  AST_NODE_TYPES,
  ASTUtils,
  type TSESTree,
} from "@typescript-eslint/utils";

const createRule = lintRuleCreator(import.meta.url);

// A test runs inside a checkout that something else may be reading at the same
// moment: main runs its tests right after it deploys, in the slot it SERVES
// from. On 2026-11-24 `database/core/internal/config.test.ts` made its probe
// dir beside itself (`mkdtempSync(join(import.meta.dir, ".config-test-"))`),
// main's faceted plugin-tree walk met the dir mid-run and failed
// (report-1795554708-scgii6). The dir was removed in `afterAll`, so nothing
// that compares the tree before and after a run would ever have seen it.
//
// So a test file (or a `testing/` fixture) never creates, writes, moves or
// removes a path whose BASE is its checkout. A path's base is where it is
// rooted: the first argument of `join` / `resolve` / `dirname` / `mkdtemp` / …,
// the leading expression of a template or a `+`, either branch of a `?:` /
// `??` / `||`, and — through an identifier — every value the binding is given
// (its initializer and every later assignment, so a `let` set in `beforeAll`
// counts). The checkout bases: `import.meta.dir` / `dirname` / `path` / `url` /
// `filename`, `__dirname` / `__filename`, `process.cwd()` (or an imported
// `cwd()`), an imported repo-root constant (`REPO_ROOT`, …, by its exported
// name, aliased or through a namespace) and a zero-argument root getter
// (`getMainRepoRoot()`, `getWorktreeRoot()`, …). `tmpdir()`, a string literal,
// a parameter and any other call are not checkout bases — so
// `join(tmpRoot, relative(REPO_ROOT, x))` (a repo layout rebuilt under a temp
// root) and `join(tmpRoot, basename(import.meta.path))` are fine.
//
// Only a write's destination argument is judged: `copyFileSync(src, dst)` may
// copy a repo file out, and `symlinkSync(target, link)` may point into the
// tree from a temp dir. Not seen: a bare relative path (`writeFileSync("x")`,
// resolved against the cwd) and a write reached through a helper function.

/** fs write calls (and `fs/promises` twins) → the indices of the paths they write. */
const FS_WRITES: ReadonlyMap<string, readonly number[]> = new Map(
  Object.entries({
    writeFile: [0],
    appendFile: [0],
    mkdir: [0],
    mkdtemp: [0],
    rm: [0],
    rmdir: [0],
    unlink: [0],
    truncate: [0],
    createWriteStream: [0],
    copyFile: [1],
    cp: [1],
    symlink: [1],
    link: [1],
    rename: [0, 1],
  }),
);

/** Calls whose result is rooted where their first argument is. */
const PATH_PASSING = new Set([
  "join",
  "resolve",
  "dirname",
  "normalize",
  "mkdtemp",
  "mkdtempSync",
  "realpath",
  "realpathSync",
  "fileURLToPath",
  "asAppPath",
  "joinAppPath",
  "String",
]);

const META_PATH_PROPS = new Set(["dir", "dirname", "path", "url", "filename"]);
const ROOT_CONST_RE =
  /^(REPO_ROOT|repoRoot|mainRepoRoot|MAIN_REPO_ROOT|CHECKOUT_ROOT|checkoutRoot|WORKTREE_ROOT|worktreeRoot)$/;
const ROOT_GETTER_RE = /^get(Main)?(Repo|Checkout|Worktree)Root$/;

function propName(node: TSESTree.Node): string | null {
  return node.type === AST_NODE_TYPES.MemberExpression &&
    !node.computed &&
    node.property.type === AST_NODE_TYPES.Identifier
    ? node.property.name
    : null;
}

function calleeName(node: TSESTree.CallExpression): string | null {
  return node.callee.type === AST_NODE_TYPES.Identifier
    ? node.callee.name
    : propName(node.callee);
}

function isImportMeta(node: TSESTree.Node): boolean {
  return (
    node.type === AST_NODE_TYPES.MetaProperty && node.meta.name === "import"
  );
}

/** The path arguments `call` writes, or null when it is no write. */
function writtenArgs(call: TSESTree.CallExpression): readonly number[] | null {
  const name = calleeName(call);
  if (name === null) return null;
  const callee = call.callee;
  if (name === "write" && callee.type === AST_NODE_TYPES.MemberExpression) {
    // `Bun.write(path, …)`, `Bun.file(path).write(…)`.
    if (
      callee.object.type === AST_NODE_TYPES.Identifier &&
      callee.object.name === "Bun"
    )
      return [0];
    return null;
  }
  if (name === "open" || name === "openSync") {
    const flags = call.arguments[1];
    return flags?.type === AST_NODE_TYPES.Literal &&
      typeof flags.value === "string" &&
      /[wa+]/.test(flags.value)
      ? [0]
      : null;
  }
  return FS_WRITES.get(name.replace(/Sync$/, "")) ?? null;
}

type Verdict = { anchor: string } | null;

export default createRule({
  name: "no-source-tree-write",
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a test from writing under its own checkout (import.meta.dir, __dirname, the repo root, process.cwd()) — main runs its tests inside the slot it serves from.",
    },
    schema: [],
    messages: {
      sourceTreeWrite:
        "This test writes under its checkout (the path is rooted at `{{anchor}}`). Main runs its tests inside the " +
        "slot it serves from, so anything a test makes there — even for a moment — is seen by whatever walks that " +
        'tree (report-1795554708-scgii6). Make it under `os.tmpdir()` instead (`mkdtempSync(join(tmpdir(), "…-"))`): ' +
        "`./equin test` points TMPDIR at the run's own scratch root and removes it when the run ends.",
    },
  },
  defaultOptions: [],
  create(context) {
    if (!isTestCodePath(repoRelativeSegments(context.filename, context.cwd)))
      return {};

    const memo = new Map<TSESTree.Node, Verdict>();

    /** Where the path `node` evaluates to is rooted, when that is the checkout. */
    function rootOf(node: TSESTree.Node | null | undefined): Verdict {
      if (!node) return null;
      if (memo.has(node)) return memo.get(node) ?? null;
      memo.set(node, null); // a cycle (`p = join(p, "x")`) answers from its other values
      const verdict = computeRoot(node);
      memo.set(node, verdict);
      return verdict;
    }

    function computeRoot(node: TSESTree.Node): Verdict {
      const T = AST_NODE_TYPES;
      if (node.type === T.MemberExpression) {
        const prop = propName(node);
        if (prop === null) return null;
        if (isImportMeta(node.object))
          return META_PATH_PROPS.has(prop)
            ? { anchor: `import.meta.${prop}` }
            : null;
        // `rr.REPO_ROOT` (a namespace import, a config object).
        return ROOT_CONST_RE.test(prop) ? { anchor: prop } : null;
      }
      if (node.type === T.Identifier) return identifierRoot(node);
      if (node.type === T.CallExpression) {
        const name = calleeName(node);
        if (name === null) return null;
        if (name === "cwd" && node.arguments.length === 0)
          return isCwdCallee(node.callee) ? { anchor: "process.cwd()" } : null;
        if (ROOT_GETTER_RE.test(name) && node.arguments.length === 0)
          return { anchor: `${name}()` };
        return PATH_PASSING.has(name) ? rootOf(node.arguments[0]) : null;
      }
      // `new URL("./out", import.meta.url)`.
      if (node.type === T.NewExpression)
        return node.callee.type === T.Identifier && node.callee.name === "URL"
          ? (rootOf(node.arguments[1]) ?? rootOf(node.arguments[0]))
          : null;
      if (node.type === T.TemplateLiteral)
        return node.quasis[0]?.value.cooked === ""
          ? rootOf(node.expressions[0])
          : null;
      if (node.type === T.BinaryExpression)
        return node.operator === "+" ? rootOf(node.left) : null;
      if (node.type === T.ConditionalExpression)
        return rootOf(node.consequent) ?? rootOf(node.alternate);
      if (node.type === T.LogicalExpression)
        return rootOf(node.left) ?? rootOf(node.right);
      if (node.type === T.AwaitExpression) return rootOf(node.argument);
      if (
        node.type === T.TSAsExpression ||
        node.type === T.TSNonNullExpression ||
        node.type === T.TSSatisfiesExpression ||
        node.type === T.TSTypeAssertion
      )
        return rootOf(node.expression);
      if (node.type === T.AssignmentExpression) return rootOf(node.right);
      // A literal, a parameter's use, any other call: not the checkout.
      return null;
    }

    /** `process.cwd` or a `cwd` imported from node:process. */
    function isCwdCallee(callee: TSESTree.Expression): boolean {
      if (callee.type === AST_NODE_TYPES.MemberExpression)
        return (
          callee.object.type === AST_NODE_TYPES.Identifier &&
          callee.object.name === "process"
        );
      if (callee.type !== AST_NODE_TYPES.Identifier) return false;
      const def = ASTUtils.findVariable(
        context.sourceCode.getScope(callee),
        callee,
      )?.defs[0];
      return (
        def?.type === "ImportBinding" &&
        def.parent.type === AST_NODE_TYPES.ImportDeclaration &&
        /^(node:)?process$/.test(def.parent.source.value)
      );
    }

    function identifierRoot(id: TSESTree.Identifier): Verdict {
      const variable = ASTUtils.findVariable(
        context.sourceCode.getScope(id),
        id,
      );
      const def = variable?.defs[0];
      if (!variable || !def)
        return id.name === "__dirname" || id.name === "__filename"
          ? { anchor: id.name }
          : null;
      if (def.type === "ImportBinding") {
        // Judged by the EXPORTED name, so an alias does not hide it.
        const imported =
          def.node.type === AST_NODE_TYPES.ImportSpecifier &&
          def.node.imported.type === AST_NODE_TYPES.Identifier
            ? def.node.imported.name
            : variable.name;
        return ROOT_CONST_RE.test(imported) ? { anchor: imported } : null;
      }
      if (def.type !== "Variable") return null;
      const values: TSESTree.Node[] = [];
      const declarator = def.node;
      if (declarator.id.type === AST_NODE_TYPES.Identifier) {
        if (declarator.init) values.push(declarator.init);
      } else if (
        // `const { dir } = import.meta`.
        declarator.id.type === AST_NODE_TYPES.ObjectPattern &&
        declarator.init &&
        isImportMeta(declarator.init)
      ) {
        const prop = declarator.id.properties.find(
          (p) =>
            p.type === AST_NODE_TYPES.Property &&
            p.value.type === AST_NODE_TYPES.Identifier &&
            p.value.name === variable.name,
        );
        const key =
          prop?.type === AST_NODE_TYPES.Property &&
          prop.key.type === AST_NODE_TYPES.Identifier
            ? prop.key.name
            : null;
        return key && META_PATH_PROPS.has(key)
          ? { anchor: `import.meta.${key}` }
          : null;
      }
      // Every later assignment too: `let dir; beforeAll(() => { dir = … })`.
      for (const ref of variable.references) {
        if (ref.isWrite() && ref.writeExpr && ref.writeExpr !== declarator.init)
          values.push(ref.writeExpr);
      }
      for (const value of values) {
        const inner = rootOf(value);
        if (inner)
          return {
            anchor:
              inner.anchor.startsWith(`${variable.name} ← `) ||
              inner.anchor === variable.name
                ? inner.anchor
                : `${variable.name} ← ${inner.anchor}`,
          };
      }
      return null;
    }

    return {
      CallExpression(node) {
        const indices = writtenArgs(node);
        let paths = indices?.map((i) => node.arguments[i]) ?? [];
        // `Bun.file(path).write(…)`: the path is the file's.
        if (
          !indices &&
          calleeName(node) === "write" &&
          node.callee.type === AST_NODE_TYPES.MemberExpression &&
          node.callee.object.type === AST_NODE_TYPES.CallExpression &&
          calleeName(node.callee.object) === "file" &&
          propName(node.callee.object.callee) === "file" &&
          node.callee.object.callee.type === AST_NODE_TYPES.MemberExpression &&
          node.callee.object.callee.object.type === AST_NODE_TYPES.Identifier &&
          node.callee.object.callee.object.name === "Bun"
        )
          paths = [node.callee.object.arguments[0]];
        for (const arg of paths) {
          if (!arg || arg.type === AST_NODE_TYPES.SpreadElement) continue;
          const verdict = rootOf(arg);
          if (verdict) {
            context.report({
              node: arg,
              messageId: "sourceTreeWrite",
              data: verdict,
            });
            return;
          }
        }
      },
    };
  },
});

/**
 * The file's path segments below the lint run's cwd (the repo root), so a
 * checkout that itself sits under a `testing/` dir does not make every file
 * test code. A file outside the cwd keeps its whole path.
 */
function repoRelativeSegments(filename: string, cwd: string): string[] {
  const file = filename.split("\\").join("/");
  const root = `${cwd.split("\\").join("/").replace(/\/$/, "")}/`;
  return (file.startsWith(root) ? file.slice(root.length) : file).split("/");
}
