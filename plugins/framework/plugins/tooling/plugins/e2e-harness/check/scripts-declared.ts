import type {
  Check,
  CheckResult,
} from "@plugins/framework/plugins/tooling/core";
import {
  fileSetImports,
  foldRepoFiles,
} from "@plugins/plugin-meta/plugins/plugin-records/core";
import { isTestFilePath } from "@plugins/framework/plugins/tooling/plugins/test-layout/core";
import { e2eScriptSchema, isE2eScriptPath } from "../core";
import {
  DECLARATION_BINDING,
  DECLARATION_TYPE,
  scriptsDeclaredFold,
  type E2eModulePart,
} from "./scripts-declared.scan";

/**
 * Every e2e module says what it is, so a runner — and a person — can select
 * scripts by declaration, never by a name pattern.
 *
 * A module under a plugin's `e2e/` is one of two things, and which one is a
 * fact of the import graph, not of its name:
 *
 * - a **helper**: another module imports it, or it is the folder's barrel
 *   (`<plugin>/e2e/index.ts`). It declares nothing — that it is imported says
 *   it all, and a declaration would be a second copy that could disagree. A
 *   helper must not declare: a runnable script that is imported runs its body
 *   inside its importer.
 * - a **library**: nothing imports it at runtime, but it has no top-level
 *   statement that executes (declarations only — reached by `import type`,
 *   an edge the runtime graph erases). It does nothing when run, so it is no
 *   script and declares nothing.
 * - a **script**: nothing imports it and it executes. It declares exactly one top-level
 *   `export const e2e = { … } satisfies E2eScript` (`core/internal/declaration.ts`)
 *   — kind `test` | `tool` with its target, whether it writes and whether it
 *   may run unattended; or kind `helper` for a module loaded BY PATH (a
 *   bundler entry), which no import can show.
 *
 * tsc checks the declaration's values (`satisfies`); this check reads it
 * statically — importing a script runs it — so it must be literals, and
 * re-validates it with the same schema. Two cross-field rules tsc cannot see
 * cheaply: a script that calls `openDeployDb` writes (the helper refuses main
 * even to read), and a script with no app target writes nothing to one.
 *
 * Importers are only ever e2e modules (the boundary table: no other folder may
 * import an `e2e/` barrel), so only the e2e folders' edges are read — off the
 * shared module graph (`fileSetImports`: static imports as the runtime reads
 * them, type-only erased, plus `import()`s), whose records are keyed by blob, so
 * a pass after an edit rescans the edited modules alone; the declarations are a
 * fold kept the same way. Test files sitting under `e2e/` count as importers but
 * are not scripts.
 */

const BARREL = /^plugins\/(?:[^/]+\/plugins\/)*[^/]+\/e2e\/index\.tsx?$/;

/** What an author reads for each problem; empty when every module agrees. */
export function e2eDeclarationProblems(
  parts: readonly E2eModulePart[],
  imports: ReadonlyMap<string, readonly string[]>,
): string[] {
  const importedBy = new Map<string, string>();
  for (const [importer, targets] of imports) {
    for (const target of targets) {
      if (target !== importer && !importedBy.has(target)) {
        importedBy.set(target, importer);
      }
    }
  }

  const problems: string[] = [];
  for (const part of parts) {
    if (isTestFilePath(part.rel)) continue;
    const importer = importedBy.get(part.rel);
    const barrel = BARREL.test(part.rel);
    const decls = part.declarations;

    if (barrel || importer !== undefined) {
      if (decls.length > 0) {
        const why = barrel ? "it is the e2e barrel" : `${importer} imports it`;
        problems.push(
          `${part.rel}:${decls[0]!.line}: a helper declares nothing (${why}) — remove \`export const ${DECLARATION_BINDING}\`, or stop importing a runnable script`,
        );
      }
      continue;
    }

    if (decls.length === 0) {
      // Imported by nobody at runtime, but it does nothing when run: a
      // library (types, functions) reached by `import type` or not at all.
      if (!part.executes) continue;
      problems.push(
        `${part.rel}: nothing imports it, so it is a script — declare \`export const ${DECLARATION_BINDING} = { kind, target, writes, run } satisfies ${DECLARATION_TYPE};\` (or delete it if it is a dead helper)`,
      );
      continue;
    }
    if (decls.length > 1) {
      problems.push(
        `${part.rel}: declares \`${DECLARATION_BINDING}\` ${decls.length} times — keep one`,
      );
      continue;
    }
    const decl = decls[0]!;
    if (!decl.ok) {
      problems.push(`${part.rel}:${decl.line}: ${decl.error}`);
      continue;
    }
    const parsed = e2eScriptSchema.safeParse(decl.value);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      problems.push(
        `${part.rel}:${decl.line}: invalid declaration — ${issues}`,
      );
      continue;
    }
    const value = parsed.data;
    if (value.kind === "helper") continue;
    if (value.target === "none" && value.writes) {
      problems.push(
        `${part.rel}:${decl.line}: \`target: "none"\` with \`writes: true\` — with no app deploy there is nothing to write to; host-side effects are a \`run.manual\` reason (\`stateful\`)`,
      );
    }
    if (part.opensDeployDb && !value.writes) {
      problems.push(
        `${part.rel}:${decl.line}: calls \`openDeployDb\` (refuses main) yet declares \`writes: false\` — it needs a writable build`,
      );
    }
  }
  return problems;
}

const check: Check = {
  id: "e2e-harness:scripts-declared",
  description:
    "every module under a plugin's e2e/ is either imported (a helper, declaring nothing) or declares what it is — `export const e2e = { kind, target, writes, run } satisfies E2eScript` — as literals a runner reads without running it",
  async run(ctx): Promise<CheckResult> {
    const repo = await ctx.repo();
    const modules = repo
      .all()
      .filter((p) => isE2eScriptPath(p) && ctx.inScope(p));
    const [parts, staticEdges, dynamicEdges] = await Promise.all([
      foldRepoFiles(repo, modules, scriptsDeclaredFold, null),
      fileSetImports(repo, modules),
      fileSetImports(repo, modules, { edges: "dynamic" }),
    ]);
    const imports = new Map<string, string[]>();
    for (const m of modules) {
      imports.set(m, [
        ...(staticEdges.get(m) ?? []),
        ...(dynamicEdges.get(m) ?? []),
      ]);
    }
    const problems = e2eDeclarationProblems(parts, imports);
    if (problems.length === 0) return { ok: true };
    return {
      ok: false,
      message: `${problems.length} e2e declaration problem(s):\n${problems.map((p) => `  ${p}`).join("\n")}`,
      hint:
        "A script declares what it is so a runner can pick it by declaration: " +
        "kind (test: the exit code is the verdict; tool: an artifact for a person), " +
        'target ("build" | { composition } | "none"), writes (changes its deploy\'s data), ' +
        'run ("auto" | { manual: [reasons], why }). ' +
        "See plugins/framework/plugins/tooling/plugins/e2e-harness/CLAUDE.md § Every script declares what it is.",
    };
  },
};

export default check;
