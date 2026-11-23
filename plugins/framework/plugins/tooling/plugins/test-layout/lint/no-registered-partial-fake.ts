import { lintRuleCreator } from "@plugins/framework/plugins/tooling/plugins/lint/core";
import type { TSESLint, TSESTree } from "@typescript-eslint/utils";

const createRule = lintRuleCreator(import.meta.url);

/**
 * A partial fake — an object literal forced to a contract type through
 * `as unknown as T` — may not be handed to a registration call (`X.define(…)`,
 * `X.provide(…)`, `X.register(…)`, `registerX(…)`, `installX(…)`, `provideX(…)`).
 *
 * A registration puts the value in a process-wide registry that every later
 * reader trusts to be a whole `T`. The double cast is exactly what tells the
 * type checker to stop checking that, so the missing members surface as
 * `x.subscribe is not a function` in whichever code reads the registry next —
 * another test in the file, or, when files shared one process, another file
 * altogether (2026-11: `turns-stop-typed.test.ts` registered a ConversationRuntime
 * fake with no `subscribe`, and `spawn-dead-letter.test.ts` crashed on it).
 *
 * The fix is a fake the checker sees whole (`{ … } satisfies T`), or
 * `partialFake<T>(name, members)` (test-layout/core/testing), whose missing
 * members throw naming themselves at the read. A double cast of a non-literal (`t.db as unknown as Db` — a
 * real object seen through another type) is not a partial fake and stays valid.
 */
export default createRule({
  name: "no-registered-partial-fake",
  meta: {
    type: "problem",
    docs: {
      description:
        "Never register an `{ … } as unknown as T` partial fake into a registry: " +
        "every later reader trusts it to be a whole T.",
    },
    schema: [],
    messages: {
      registeredPartialFake:
        "This registers a partial fake (`{ … } as unknown as {{type}}`) into a " +
        "process-wide registry, where every later reader trusts it to be a whole " +
        "{{type}} — a missing member surfaces as `x.member is not a function` in " +
        "someone else's code. Write it as `{ … } satisfies {{type}}` (every member " +
        "present), or as `partialFake<{{type}}>(name, { … })` from " +
        "test-layout/core/testing, whose missing members throw naming themselves.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node: TSESTree.CallExpression) {
        if (!isRegistrationCall(node.callee)) return;
        for (const arg of node.arguments) {
          const fake = partialFakeOf(arg, context);
          if (fake === null) continue;
          context.report({
            node: arg,
            messageId: "registeredPartialFake",
            data: { type: context.sourceCode.getText(fake.typeAnnotation) },
          });
        }
      },
    };
  },
});

const REGISTRATION_METHODS = new Set(["define", "provide", "register"]);
const REGISTRATION_FUNCTION = /^(register|install|provide)[A-Z]/;

function isRegistrationCall(callee: TSESTree.Expression): boolean {
  if (callee.type === "Identifier")
    return REGISTRATION_FUNCTION.test(callee.name);
  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier"
  ) {
    const name = callee.property.name;
    return REGISTRATION_METHODS.has(name) || REGISTRATION_FUNCTION.test(name);
  }
  return false;
}

/** `{ … } as unknown as T`, directly or through a `const` it initialises. */
function partialFakeOf(
  arg: TSESTree.CallExpressionArgument,
  context: Readonly<TSESLint.RuleContext<string, []>>,
): Cast | null {
  if (arg.type === "Identifier") {
    const variable = findVariable(context.sourceCode.getScope(arg), arg.name);
    const def = variable?.defs[0];
    if (
      def === undefined ||
      def.node.type !== "VariableDeclarator" ||
      def.node.init === null ||
      def.parent?.type !== "VariableDeclaration" ||
      def.parent.kind !== "const"
    ) {
      return null;
    }
    return doubleCastLiteral(def.node.init);
  }
  return doubleCastLiteral(arg);
}

/** A cast, in either spelling: `e as T` or `<T>e`. */
type Cast = TSESTree.TSAsExpression | TSESTree.TSTypeAssertion;

function isCast(node: TSESTree.Node): node is Cast {
  return node.type === "TSAsExpression" || node.type === "TSTypeAssertion";
}

function doubleCastLiteral(expr: TSESTree.Node): Cast | null {
  if (!isCast(expr)) return null;
  const inner = expr.expression;
  if (
    !isCast(inner) ||
    inner.typeAnnotation.type !== "TSUnknownKeyword" ||
    inner.expression.type !== "ObjectExpression"
  ) {
    return null;
  }
  return expr;
}

function findVariable(
  scope: TSESLint.Scope.Scope,
  name: string,
): TSESLint.Scope.Variable | undefined {
  for (let s: TSESLint.Scope.Scope | null = scope; s !== null; s = s.upper) {
    const found = s.set.get(name);
    if (found !== undefined) return found;
  }
  return undefined;
}
