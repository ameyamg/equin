import { lintRuleCreator } from "@plugins/framework/plugins/tooling/plugins/lint/core";
import type { TSESTree } from "@typescript-eslint/utils";

const createRule = lintRuleCreator(import.meta.url);

const PROBE_MODULE = "@plugins/packages/plugins/process-alive/core";

/** `process.kill`. */
function isProcessKill(callee: TSESTree.Node): boolean {
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.object.type === "Identifier" &&
    callee.object.name === "process" &&
    callee.property.type === "Identifier" &&
    callee.property.name === "kill"
  );
}

/** `0` or `"0"`: the signal that delivers nothing and only asks. */
function isSignalZero(node: TSESTree.Node | undefined): boolean {
  return node?.type === "Literal" && (node.value === 0 || node.value === "0");
}

/**
 * no-signal-zero-probe
 *
 * "Is this pid alive" was hand-rolled 22 times as `process.kill(pid, 0)` in a
 * try/catch, and the copies disagreed on the two arms that matter: some read
 * every error but EPERM as dead, one read every error but ESRCH as alive, and
 * none refused pid 0 (`kill(0, 0)` probes the caller's own process group, so
 * a pidfile holding 0 read as a live process). packages/process-alive holds
 * the one reading — ESRCH dead, EPERM alive, anything else thrown, a non-pid
 * refused — as `isProcessAlive(pid)` and `isProcessGroupAlive(pgid)`.
 * Syntactic: `process.kill(<x>, 0)`.
 */
export default createRule({
  name: "no-signal-zero-probe",
  meta: {
    type: "problem",
    docs: {
      description:
        "A pid liveness probe is isProcessAlive / isProcessGroupAlive (packages/process-alive), never a hand-rolled process.kill(pid, 0).",
    },
    schema: [],
    messages: {
      probe: `A hand-rolled \`process.kill(pid, 0)\` is one more copy of the liveness reading, and copies drift (EPERM read as dead, errors swallowed, pid 0 probing our own group). Use \`isProcessAlive(pid)\` or \`isProcessGroupAlive(pgid)\` from "${PROBE_MODULE}".`,
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        if (isProcessKill(node.callee) && isSignalZero(node.arguments[1]))
          context.report({ node, messageId: "probe" });
      },
    };
  },
});
