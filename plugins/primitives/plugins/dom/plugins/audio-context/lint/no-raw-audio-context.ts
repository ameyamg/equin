import { lintRuleCreator } from "@plugins/framework/plugins/tooling/plugins/lint/core";
import type { TSESTree } from "@typescript-eslint/utils";

/**
 * no-raw-audio-context
 *
 * A context's resume() asked for before a user gesture stays pending, and
 * closing the context meanwhile (leaving the app before any click) rejects it
 * with an InvalidStateError ("Closed before resume completed") — an unhandled
 * rejection for a fire-and-forget `void ctx.resume()` (report-1795059421-nnk0da).
 * Build contexts with `openAudioContext()` from
 * `@plugins/primitives/plugins/dom/plugins/audio-context/web`: its owner holds
 * the only resume and close and answers its own teardown as `closed`.
 *
 * Syntactic: flags `new AudioContext(…)` / `new webkitAudioContext(…)` (bare
 * or as a member of `window` / `globalThis` / `self`), and a zero-argument
 * `.resume()` whose result is used as a promise (`await`, `void`, `.then` /
 * `.catch` / `.finally`) — a stream's or a controller's resume() returns
 * nothing to chain, so it is not flagged. An OfflineAudioContext renders to a
 * buffer and never waits on a gesture, so it is not flagged.
 */

const createRule = lintRuleCreator(import.meta.url);

const CONSTRUCTORS = new Set(["AudioContext", "webkitAudioContext"]);
const GLOBAL_OBJECTS = new Set(["window", "globalThis", "self"]);

function memberName(node: TSESTree.MemberExpression): string | null {
  const p = node.property;
  if (!node.computed) return p.type === "Identifier" ? p.name : null;
  return p.type === "Literal" && typeof p.value === "string" ? p.value : null;
}

function constructedName(node: TSESTree.NewExpression): string | null {
  const callee = node.callee;
  if (callee.type === "Identifier")
    return CONSTRUCTORS.has(callee.name) ? callee.name : null;
  if (
    callee.type === "MemberExpression" &&
    callee.object.type === "Identifier" &&
    GLOBAL_OBJECTS.has(callee.object.name)
  ) {
    const name = memberName(callee);
    return name !== null && CONSTRUCTORS.has(name) ? name : null;
  }
  return null;
}

function isResumeCall(node: TSESTree.CallExpression): boolean {
  const callee = node.callee;
  if (callee.type !== "MemberExpression" || node.arguments.length > 0)
    return false;
  return memberName(callee) === "resume";
}

function usedAsPromise(node: TSESTree.Node): boolean {
  const parent = node.parent;
  if (parent === undefined) return false;
  if (parent.type === "ChainExpression") return usedAsPromise(parent);
  if (parent.type === "AwaitExpression") return true;
  if (parent.type === "UnaryExpression") return parent.operator === "void";
  return (
    parent.type === "MemberExpression" &&
    parent.object === node &&
    !parent.computed &&
    parent.property.type === "Identifier" &&
    ["then", "catch", "finally"].includes(parent.property.name)
  );
}

export default createRule({
  name: "no-raw-audio-context",
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a raw new AudioContext and raw .resume() promise — open contexts with openAudioContext() from " +
        "@plugins/primitives/plugins/dom/plugins/audio-context/web, whose owner holds the only resume and close.",
    },
    schema: [],
    messages: {
      noRawConstruct:
        "A raw {{name}} has no owner of its resume and close: a resume pending at close rejects unhandled " +
        "('Closed before resume completed'). Use openAudioContext() from " +
        "@plugins/primitives/plugins/dom/plugins/audio-context/web.",
      noRawResume:
        "A raw .resume() promise rejects when the context closes before it completes (a page left before " +
        "any gesture). Resume through the OwnedAudioContext from openAudioContext() " +
        "(@plugins/primitives/plugins/dom/plugins/audio-context/web), which answers that as closed.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      NewExpression(node: TSESTree.NewExpression) {
        const name = constructedName(node);
        if (name === null) return;
        context.report({
          node,
          messageId: "noRawConstruct",
          data: { name: `new ${name}` },
        });
      },
      CallExpression(node: TSESTree.CallExpression) {
        if (!isResumeCall(node) || !usedAsPromise(node)) return;
        context.report({ node, messageId: "noRawResume" });
      },
    };
  },
});
