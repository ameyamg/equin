import type { FileFold } from "@plugins/plugin-meta/plugins/plugin-records/core";
import ts from "typescript";

// e2e-harness:scripts-declared's per-file work as a fold kept along the
// directory tree: each e2e module's `export const e2e = …` declaration, from
// its own bytes, so a pass after an edit parses only the edited files. Which
// modules are helpers is a cross-file fact read off the shared module graph
// (plugin-records' `fileSetImports`), never resolved here.

/** The declaration as written, or why it could not be read statically. */
export type ReadDeclaration =
  | { readonly ok: true; readonly value: unknown; readonly line: number }
  | { readonly ok: false; readonly error: string; readonly line: number };

/** One e2e module, as the verdict needs it. */
export interface E2eModulePart {
  readonly rel: string;
  /** Every top-level `export const e2e` (more than one is an error). */
  readonly declarations: readonly ReadDeclaration[];
  /** Whether it calls `openDeployDb` itself (a deploy-DB connection: never main). */
  readonly opensDeployDb: boolean;
  /**
   * Whether running it does anything: a top-level statement that executes — a
   * call, an assignment, control flow, an `await` in an initializer. A module
   * of declarations alone (types, functions, constants) is a library whatever
   * imports it, even when only `import type` does (an edge the runtime graph
   * erases).
   */
  readonly executes: boolean;
}

/** Does this top-level statement run code when the module loads, beyond declaring? */
function statementExecutes(stmt: ts.Statement): boolean {
  if (
    ts.isImportDeclaration(stmt) ||
    ts.isImportEqualsDeclaration(stmt) ||
    ts.isExportDeclaration(stmt) ||
    ts.isInterfaceDeclaration(stmt) ||
    ts.isTypeAliasDeclaration(stmt) ||
    ts.isFunctionDeclaration(stmt) ||
    ts.isClassDeclaration(stmt) ||
    ts.isEnumDeclaration(stmt) ||
    ts.isModuleDeclaration(stmt) ||
    ts.isEmptyStatement(stmt)
  ) {
    return false;
  }
  if (ts.isVariableStatement(stmt)) {
    let awaits = false;
    const visit = (n: ts.Node): void => {
      if (awaits || ts.isFunctionLike(n) || ts.isClassLike(n)) return;
      if (ts.isAwaitExpression(n) || ts.isForOfStatement(n)) awaits = true;
      else ts.forEachChild(n, visit);
    };
    visit(stmt);
    return awaits;
  }
  return true;
}

/** The binding name and the type a declaration satisfies. */
export const DECLARATION_BINDING = "e2e";
export const DECLARATION_TYPE = "E2eScript";

class NotLiteral extends Error {}

/** A literal expression's value: strings, booleans, numbers, arrays, objects. */
function literalValue(node: ts.Expression): unknown {
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) {
    return literalValue(node.expression);
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((e) => literalValue(e));
  }
  if (ts.isObjectLiteralExpression(node)) {
    const out: Record<string, unknown> = {};
    for (const prop of node.properties) {
      if (
        !ts.isPropertyAssignment(prop) ||
        !(ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
      ) {
        throw new NotLiteral(prop.getText());
      }
      out[prop.name.text] = literalValue(prop.initializer);
    }
    return out;
  }
  throw new NotLiteral(node.getText());
}

function readDeclaration(
  sf: ts.SourceFile,
  decl: ts.VariableDeclaration,
): ReadDeclaration {
  const line = sf.getLineAndCharacterOfPosition(decl.getStart(sf)).line + 1;
  const init = decl.initializer;
  if (
    init === undefined ||
    !ts.isSatisfiesExpression(init) ||
    !ts.isTypeReferenceNode(init.type) ||
    init.type.typeName.getText(sf) !== DECLARATION_TYPE
  ) {
    return {
      ok: false,
      line,
      error: `write it as \`export const ${DECLARATION_BINDING} = { … } satisfies ${DECLARATION_TYPE};\``,
    };
  }
  try {
    return { ok: true, line, value: literalValue(init.expression) };
  } catch (err) {
    if (!(err instanceof NotLiteral)) throw err;
    return {
      ok: false,
      line,
      error: `\`${err.message}\` is not a literal — the declaration is read without running the script, so it holds literals only`,
    };
  }
}

/** One module's part: its declarations, from its own bytes. */
export function scanE2eModule(src: string, rel: string): E2eModulePart {
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true);
  const declarations: ReadDeclaration[] = [];
  let opensDeployDb = false;

  for (const stmt of sf.statements) {
    if (
      ts.isVariableStatement(stmt) &&
      stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === DECLARATION_BINDING) {
          declarations.push(readDeclaration(sf, d));
        }
      }
    }
  }

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "openDeployDb"
    ) {
      opensDeployDb = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return {
    rel,
    declarations,
    opensDeployDb,
    executes: sf.statements.some(statementExecutes),
  };
}

export const scriptsDeclaredFold: FileFold<null, E2eModulePart[]> = {
  url: import.meta.url,
  scan: (src, rel) => [scanE2eModule(src, rel)],
  combine: (parts) => parts.flat(),
};
