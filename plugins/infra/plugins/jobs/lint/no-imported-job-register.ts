import { lintRuleCreator } from "@plugins/framework/plugins/tooling/plugins/lint/core";
import { ESLintUtils, type TSESLint } from "@typescript-eslint/utils";

const createRule = lintRuleCreator(import.meta.url);

/**
 * no-imported-job-register
 *
 * A job a module exports is registered by its plugin's `register` list, the
 * one source every host's register phase reads. Calling `.register()` on an
 * IMPORTED job by hand is a second, hand-kept source: it diverges from the
 * plugin's list, and in the one `bun test` process it collides with any suite
 * that registers the same plugin (`[jobs] duplicate job name`). A headless
 * suite whose code enqueues a plugin's job calls `registerPluginJobs([plugin])`
 * (jobs' `server/testing`) instead. A job the file defines itself (a test's
 * own fixture, a wrapper registering the job it wraps) is not imported, so it
 * is not reported.
 *
 * Type-aware: reported on a `.register()` call whose receiver is an imported
 * binding whose type has the job factory's `enqueue` and `inFlight` members.
 */
export default createRule({
  name: "no-imported-job-register",
  meta: {
    type: "problem",
    docs: {
      description:
        "An imported job is registered by its plugin's `register` list — in a test, `registerPluginJobs([plugin])` from jobs' server/testing — never by calling `.register()` on it by hand.",
      requiresTypeChecking: true,
    },
    schema: [],
    messages: {
      imported:
        'Do not register an imported job by hand: its plugin\'s `register` list registers it. In a headless test, call `registerPluginJobs(["<plugin path>"])` from @plugins/infra/plugins/jobs/server/testing — it reads that list, and registers each job once per test process.',
    },
  },
  defaultOptions: [],
  create(context) {
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();
    const isImported = (scope: TSESLint.Scope.Scope, name: string): boolean => {
      for (let s: TSESLint.Scope.Scope | null = scope; s; s = s.upper) {
        const v = s.set.get(name);
        if (v !== undefined) {
          return v.defs.some((d) => d.type === "ImportBinding");
        }
      }
      return false;
    };
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type !== "MemberExpression" ||
          callee.computed ||
          callee.property.type !== "Identifier" ||
          callee.property.name !== "register" ||
          callee.object.type !== "Identifier"
        )
          return;
        if (!isImported(context.sourceCode.getScope(node), callee.object.name))
          return;
        const type = checker.getNonNullableType(
          services.getTypeAtLocation(callee.object),
        );
        if (
          type.getProperty("enqueue") === undefined ||
          type.getProperty("inFlight") === undefined
        )
          return;
        context.report({ node, messageId: "imported" });
      },
    };
  },
});
