import { lintRuleCreator } from "@plugins/framework/plugins/tooling/plugins/lint/core";
import type { TSESTree } from "@typescript-eslint/utils";

/**
 * no-raw-box-presence
 *
 * `el.getClientRects().length` is how a browser says whether an element
 * generates a box — and a host with no layout engine (jsdom) answers `0` for
 * EVERY element, so code asking it directly treats every element as hidden in
 * tests (2026-11-19: every popover closed itself, three suites red). Ask
 * `generatesBox(el)` from `@plugins/primitives/plugins/dom/plugins/box-presence/web`,
 * the one seam such a host answers from computed display.
 *
 * Flags `.length` read off a `getClientRects()` call. Reading the rects
 * themselves (`range.getClientRects()[0]`, a filter over them) is geometry,
 * not presence, and stays allowed.
 */

const createRule = lintRuleCreator(import.meta.url);

function unwrap(node: TSESTree.Node): TSESTree.Node {
  let n = node;
  while (
    n.type === "TSAsExpression" ||
    n.type === "TSNonNullExpression" ||
    n.type === "ChainExpression"
  )
    n = n.expression;
  return n;
}

function isGetClientRectsCall(node: TSESTree.Node): boolean {
  const n = unwrap(node);
  if (n.type !== "CallExpression") return false;
  const callee = unwrap(n.callee);
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier" &&
    callee.property.name === "getClientRects"
  );
}

export default createRule({
  name: "no-raw-box-presence",
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow getClientRects().length — ask generatesBox(el) from " +
        "@plugins/primitives/plugins/dom/plugins/box-presence/web, which a host without a layout engine answers.",
    },
    schema: [],
    messages: {
      noRawBoxPresence:
        "getClientRects().length asks the layout engine directly: jsdom answers 0 for every element, so this code " +
        "sees everything as hidden in tests. Use generatesBox(el) from " +
        "@plugins/primitives/plugins/dom/plugins/box-presence/web.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      MemberExpression(node: TSESTree.MemberExpression) {
        if (
          node.computed ||
          node.property.type !== "Identifier" ||
          node.property.name !== "length"
        )
          return;
        if (isGetClientRectsCall(node.object))
          context.report({ node, messageId: "noRawBoxPresence" });
      },
    };
  },
});
