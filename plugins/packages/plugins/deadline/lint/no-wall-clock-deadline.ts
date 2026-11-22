import { lintRuleCreator } from "@plugins/framework/plugins/tooling/plugins/lint/core";
import type { TSESTree } from "@typescript-eslint/utils";

const createRule = lintRuleCreator(import.meta.url);

// Browser code waits on a tab the browser itself throttles and freezes; the
// rule is about the machine's own processes (server, central, machine, bin,
// cli, scripts…). e2e scripts drive a browser from outside, harness-side.
const OUT_OF_SCOPE_SEGMENTS = ["/web/", "/e2e/", "/exhibits/"];

/** `setTimeout(...)`, `globalThis.setTimeout(...)`. */
function isSetTimeout(call: TSESTree.CallExpression): boolean {
  const callee = call.callee;
  if (callee.type === "Identifier") return callee.name === "setTimeout";
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.object.type === "Identifier" &&
    callee.object.name === "globalThis" &&
    callee.property.type === "Identifier" &&
    callee.property.name === "setTimeout"
  );
}

/**
 * A call that gives up on work: `reject(…)`, `<x>.abort(…)`, `<x>.kill(…)`,
 * `process.exit(…)`. What a watchdog does when its time is up — as opposed to
 * a debounce, a backoff or a delayed start, which just run something later.
 */
function isGiveUpCall(call: TSESTree.CallExpression): boolean {
  const callee = call.callee;
  if (callee.type === "Identifier") return callee.name === "reject";
  if (
    callee.type !== "MemberExpression" ||
    callee.computed ||
    callee.property.type !== "Identifier"
  )
    return false;
  const name = callee.property.name;
  if (name === "abort" || name === "kill") return true;
  return (
    name === "exit" &&
    callee.object.type === "Identifier" &&
    callee.object.name === "process"
  );
}

/**
 * Whether `node` gives up on work, in its own body or in a continuation it
 * starts (`read().then((s) => reject(…), reject)`): a give-up call, or a
 * `reject` handed on as a callback.
 */
function bodyGivesUp(node: TSESTree.Node): boolean {
  let found = false;
  const visit = (n: TSESTree.Node): void => {
    if (found) return;
    if (n.type === "CallExpression") {
      if (
        isGiveUpCall(n) ||
        n.arguments.some((a) => a.type === "Identifier" && a.name === "reject")
      ) {
        found = true;
        return;
      }
    }
    for (const key of Object.keys(n) as (keyof typeof n)[]) {
      if (key === "parent") continue;
      const v: unknown = n[key];
      if (Array.isArray(v)) {
        for (const c of v) if (isNode(c)) visit(c);
      } else if (isNode(v)) visit(v);
    }
  };
  visit(node);
  return found;
}

function isNode(v: unknown): v is TSESTree.Node {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { type?: unknown }).type === "string"
  );
}

/** The timer's callback gives up on work when it fires: a deadline. */
function isDeadline(call: TSESTree.CallExpression): boolean {
  // `setTimeout(fn)` / `setTimeout(fn, 0)` defers to the next turn: no time
  // is bounded, so whatever the callback does on failure, it is no deadline.
  const delay = call.arguments[1];
  if (delay === undefined || (delay.type === "Literal" && delay.value === 0))
    return false;
  const cb = call.arguments[0];
  if (cb === undefined) return false;
  // `setTimeout(reject, ms)`
  if (cb.type === "Identifier") return cb.name === "reject";
  if (cb.type === "FunctionExpression" || cb.type === "ArrowFunctionExpression")
    return bodyGivesUp(cb.body);
  return false;
}

export default createRule({
  name: "no-wall-clock-deadline",
  meta: {
    type: "problem",
    docs: {
      description:
        "A `setTimeout` whose callback gives up on work (reject, abort, kill, " +
        "process.exit) is a deadline, and `setTimeout` counts machine sleep: on " +
        "wake every timer whose time passed during the nap fires at once, so " +
        "work that ran 0.3 s is declared failed (report-1795305324-8wpwx2). " +
        "Bound work this machine runs with `armAwakeDeadline` / `withDeadline` " +
        "(`@plugins/packages/plugins/deadline/core`), which count awake time. " +
        "A deadline on something that really ages across sleep (a remote " +
        "peer's lease, an external token) is declared in the exempted " +
        "plugin's `exempt/index.ts`, with its reason.",
    },
    schema: [],
    messages: {
      wallClockDeadline:
        "This `setTimeout` gives up on work when it fires — a deadline — and " +
        "`setTimeout` counts machine sleep, so a Mac wake fails work that " +
        "barely ran. Use `armAwakeDeadline(ms, fn)` or `withDeadline(work, ms, " +
        "onTimeout)` from `@plugins/packages/plugins/deadline/core`. If the " +
        "deadline really is on wall time (a remote peer, an external token), " +
        "declare it in the plugin's `exempt/index.ts` with the reason.",
    },
  },
  defaultOptions: [],
  create(context) {
    const filename = (context.filename ?? "").split("\\").join("/");
    if (OUT_OF_SCOPE_SEGMENTS.some((s) => filename.includes(s))) return {};
    return {
      CallExpression(node: TSESTree.CallExpression) {
        if (isSetTimeout(node) && isDeadline(node)) {
          context.report({ node, messageId: "wallClockDeadline" });
        }
      },
    };
  },
});
