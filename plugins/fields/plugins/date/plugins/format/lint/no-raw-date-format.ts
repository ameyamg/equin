import { lintRuleCreator } from "@plugins/framework/plugins/tooling/plugins/lint/core";
import { ESLintUtils, type TSESTree } from "@typescript-eslint/utils";

const createRule = lintRuleCreator(import.meta.url);

/**
 * Every displayed date and time goes through the DateFormatter
 * (fields/date/format), which follows the user's Clock, Date order and
 * Numeric dates settings. The platform's own formatters take a locale and an
 * hour cycle per call, so each call site picked its own — the browser's
 * (12-hour for an en-US browser), a hard-coded "en-US", an "en-GB" — and the
 * Mail list wrote "11:17 PM" for a user who reads a 24-hour clock.
 *
 * No flaw: these are platform APIs the repo cannot remove, so the rule keeps
 * new code on the formatter. Code that computes with dates rather than
 * displaying them (zone arithmetic, a fixed machine format) declares a
 * sanctioned exemption in its own exempt/index.ts.
 */
export default createRule({
  name: "no-raw-date-format",
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow formatting a date or a time with toLocaleTimeString / toLocaleDateString / Date#toLocaleString / Intl.DateTimeFormat — use the DateFormatter.",
      requiresTypeChecking: true,
    },
    schema: [],
    messages: {
      raw:
        "Write a date or a time through the DateFormatter (@plugins/fields/plugins/date/plugins/format): " +
        "`useDateFormatter()` in a component, `serverDateFormatter()` on the server, or a " +
        "`DateFormatter` handed to a pure function. It follows the user's Clock / Date order / " +
        "Numeric dates settings; `{{api}}` follows whatever locale this call names. " +
        "Code that computes with dates rather than displaying them declares a sanctioned " +
        "exemption in its plugin's exempt/index.ts.",
    },
  },
  defaultOptions: [],
  create(context) {
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();
    const propName = (m: TSESTree.MemberExpression): string | null =>
      !m.computed && m.property.type === "Identifier" ? m.property.name : null;
    const isIntlDateTimeFormat = (callee: TSESTree.Node): boolean =>
      callee.type === "MemberExpression" &&
      callee.object.type === "Identifier" &&
      callee.object.name === "Intl" &&
      propName(callee) === "DateTimeFormat";
    const isDate = (node: TSESTree.Node): boolean => {
      const t = checker.getTypeAtLocation(
        services.esTreeNodeToTSNodeMap.get(node),
      );
      return t.getSymbol()?.getName() === "Date";
    };
    const checkIntl = (
      node: TSESTree.CallExpression | TSESTree.NewExpression,
    ) => {
      if (!isIntlDateTimeFormat(node.callee)) return;
      // `Intl.DateTimeFormat().resolvedOptions()` reads the host's zone or
      // locale — it formats nothing.
      const parent = node.parent;
      if (
        node.arguments.length === 0 &&
        parent?.type === "MemberExpression" &&
        propName(parent) === "resolvedOptions"
      )
        return;
      context.report({
        node,
        messageId: "raw",
        data: { api: "Intl.DateTimeFormat" },
      });
    };
    return {
      NewExpression: checkIntl,
      CallExpression(node) {
        checkIntl(node);
        const callee = node.callee;
        if (callee.type !== "MemberExpression") return;
        const name = propName(callee);
        if (name === "toLocaleTimeString" || name === "toLocaleDateString") {
          context.report({ node, messageId: "raw", data: { api: name } });
        } else if (name === "toLocaleString" && isDate(callee.object)) {
          context.report({
            node,
            messageId: "raw",
            data: { api: "Date#toLocaleString" },
          });
        }
      },
    };
  },
});
