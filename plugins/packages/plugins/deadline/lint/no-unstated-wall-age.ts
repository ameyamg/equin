import { lintRuleCreator } from "@plugins/framework/plugins/tooling/plugins/lint/core";
import type { TSESTree } from "@typescript-eslint/utils";

const createRule = lintRuleCreator(import.meta.url);

// Same scope as `no-wall-clock-deadline`: the machine's own processes. A
// browser tab cannot read the sleep clock, and the browser throttles and
// freezes it on its own terms.
const OUT_OF_SCOPE_SEGMENTS = ["/web/", "/e2e/", "/exhibits/"];

/** Operators that turn a reading into an age or a deadline check. */
const AGE_OPERATORS = new Set(["-", "<", "<=", ">", ">="]);

/** `Date.now()`. */
function isDateNow(node: TSESTree.Node): node is TSESTree.CallExpression {
  return (
    node.type === "CallExpression" &&
    node.arguments.length === 0 &&
    node.callee.type === "MemberExpression" &&
    !node.callee.computed &&
    node.callee.object.type === "Identifier" &&
    node.callee.object.name === "Date" &&
    node.callee.property.type === "Identifier" &&
    node.callee.property.name === "now"
  );
}

/** `new Date().getTime()` / `new Date().valueOf()`. */
function isNewDateTime(node: TSESTree.Node): node is TSESTree.CallExpression {
  if (node.type !== "CallExpression" || node.arguments.length !== 0)
    return false;
  const callee = node.callee;
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier" &&
    (callee.property.name === "getTime" ||
      callee.property.name === "valueOf") &&
    callee.object.type === "NewExpression" &&
    callee.object.callee.type === "Identifier" &&
    callee.object.callee.name === "Date" &&
    callee.object.arguments.length === 0
  );
}

/**
 * Whether `node` is an operand of an age operator, looking through the
 * expressions that carry its value unchanged (parentheses are not nodes;
 * `as` / `!` / `satisfies` are).
 */
function isAgeOperand(node: TSESTree.Node): boolean {
  let child: TSESTree.Node = node;
  let parent = child.parent;
  while (
    parent !== undefined &&
    (parent.type === "TSAsExpression" ||
      parent.type === "TSNonNullExpression" ||
      parent.type === "TSSatisfiesExpression")
  ) {
    child = parent;
    parent = child.parent;
  }
  return (
    parent !== undefined &&
    parent.type === "BinaryExpression" &&
    AGE_OPERATORS.has(parent.operator)
  );
}

export default createRule({
  name: "no-unstated-wall-age",
  meta: {
    type: "problem",
    docs: {
      description:
        "An age or a deadline check built on a bare `Date.now()` does not say " +
        "which clock it means, and the wall clock counts machine sleep: on wake " +
        "every watchdog, lease or staleness judgement on this machine's work " +
        "looks as late as the nap. Judge this machine's work on awake time " +
        "(`awakeClock()` differences, `armAwakeDeadline`, `clockStampNow()` + " +
        "`awakeBetween`), or state a deliberate wall-clock choice with " +
        "`wallNow(reason)` from `@plugins/packages/plugins/deadline/core`.",
    },
    schema: [],
    messages: {
      unstatedWallAge:
        "A bare `{{read}}` used as an age or a deadline: the wall clock counts " +
        "machine sleep, so a Mac wake makes this machine's work look stuck. " +
        "Work this machine runs is judged on AWAKE time — `awakeClock()` " +
        "differences in one process, `armAwakeDeadline` for a timer, " +
        "`clockStampNow()` + `awakeBetween` for a stored instant " +
        "(packages/sleep-clock/CLAUDE.md § Judging an age). If wall time is " +
        "right here (retention, expiry, an external deadline, a fail-open " +
        "lease, human time), say so: `wallNow(<reason>)` from " +
        "`@plugins/packages/plugins/deadline/core`.",
    },
  },
  defaultOptions: [],
  create(context) {
    const filename = (context.filename ?? "").split("\\").join("/");
    if (OUT_OF_SCOPE_SEGMENTS.some((s) => filename.includes(s))) return {};

    /**
     * Whether a binding this reading initialises is ever used as an age. A
     * binding written again after its initialiser (a `let` reassigned) holds
     * other values too, so it is not traced.
     */
    const bindingUsedAsAge = (
      id: TSESTree.Identifier,
      at: TSESTree.Node,
    ): boolean => {
      const variable = context.sourceCode.getScope(at).set.get(id.name);
      if (variable === undefined) return false;
      if (variable.references.some((ref) => ref.isWrite() && !ref.init))
        return false;
      return variable.references.some(
        (ref) => ref.isRead() && isAgeOperand(ref.identifier),
      );
    };

    /**
     * The binding a reading initialises: `const now = Date.now()` (or a `let`
     * never reassigned), or a parameter default `(now = Date.now()) => …`.
     */
    const initialisedBinding = (
      read: TSESTree.CallExpression,
    ): TSESTree.Identifier | null => {
      const parent = read.parent;
      if (
        parent.type === "VariableDeclarator" &&
        parent.init === read &&
        parent.id.type === "Identifier"
      )
        return parent.id;
      if (
        parent.type === "AssignmentPattern" &&
        parent.right === read &&
        parent.left.type === "Identifier"
      )
        return parent.left;
      return null;
    };

    const check = (read: TSESTree.CallExpression, label: string): void => {
      let flagged = isAgeOperand(read);
      if (!flagged) {
        const id = initialisedBinding(read);
        // A parameter default's binding lives in the function's scope.
        const scopeNode =
          id !== null && read.parent.type === "AssignmentPattern"
            ? read.parent.parent
            : read;
        flagged = id !== null && bindingUsedAsAge(id, scopeNode);
      }
      if (flagged)
        context.report({
          node: read,
          messageId: "unstatedWallAge",
          data: { read: label },
        });
    };

    return {
      CallExpression(node: TSESTree.CallExpression) {
        if (isDateNow(node)) check(node, "Date.now()");
        else if (isNewDateTime(node)) check(node, "new Date().getTime()");
      },
    };
  },
});
