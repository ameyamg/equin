/**
 * Tests for `no-wall-clock-deadline`: a `setTimeout` whose callback gives up
 * on work is reported outside browser code; a debounce, a backoff or a sleep
 * is not.
 */

import rule from "./no-wall-clock-deadline";
import { createRuleTester } from "@plugins/framework/plugins/tooling/plugins/lint/core/testing";

const ruleTester = createRuleTester();

const MACHINE = "/repo/plugins/foo/machine/internal/run.ts";
const SERVER = "/repo/plugins/foo/server/internal/run.ts";

ruleTester.run("no-wall-clock-deadline", rule, {
  valid: [
    // A sleep, a debounce, a delayed start: nothing is given up.
    {
      code: `await new Promise((r) => setTimeout(r, 1000));`,
      filename: MACHINE,
    },
    { code: `setTimeout(() => flush(), 50);`, filename: SERVER },
    { code: `setTimeout(() => resolve("timeout"), 50);`, filename: SERVER },
    // A deferral to the next turn bounds no time, whatever it does on failure.
    {
      code: `setTimeout(() => { run().catch(() => process.exit(1)); }, 0);`,
      filename: SERVER,
    },
    // Browser code is out of scope.
    {
      code: `setTimeout(() => ctl.abort(), 1000);`,
      filename: "/repo/plugins/foo/web/a.ts",
    },
    // The awake timer itself, and its signal.
    { code: `armAwakeDeadline(1000, () => ctl.abort());`, filename: MACHINE },
    {
      code: `fetch(u, { signal: awakeTimeoutSignal(5000) });`,
      filename: SERVER,
    },
    // A browser fetch is out of scope.
    {
      code: `fetch(u, { signal: AbortSignal.timeout(5000) });`,
      filename: "/repo/plugins/foo/web/a.ts",
    },
  ],
  invalid: [
    {
      // A request to this machine's gateway, aborted the instant the Mac woke.
      code: `await fetch(u, { signal: AbortSignal.timeout(30_000) });`,
      filename: MACHINE,
      errors: [{ messageId: "wallClockAbortSignal" }],
    },
    {
      // The give-up runs in a continuation the timer starts.
      code: `setTimeout(() => { read().then((s) => reject(new Error(s)), reject); }, 5);`,
      filename: MACHINE,
      errors: [{ messageId: "wallClockDeadline" }],
    },
    {
      code: `const t = setTimeout(() => abortController.abort(), TIMEOUT_MS);`,
      filename: MACHINE,
      errors: [{ messageId: "wallClockDeadline" }],
    },
    {
      code: `new Promise((_, reject) => setTimeout(() => reject(new Error("x")), 5));`,
      filename: SERVER,
      errors: [{ messageId: "wallClockDeadline" }],
    },
    {
      code: `new Promise((_, reject) => setTimeout(reject, 5));`,
      filename: SERVER,
      errors: [{ messageId: "wallClockDeadline" }],
    },
    {
      code: `setTimeout(() => { log("stuck"); proc.kill("SIGKILL"); }, 15_000);`,
      filename: "/repo/plugins/foo/bin/agent.ts",
      errors: [{ messageId: "wallClockDeadline" }],
    },
    {
      code: `globalThis.setTimeout(function () { process.exit(1); }, 5000);`,
      filename: "/repo/plugins/foo/cli/run.ts",
      errors: [{ messageId: "wallClockDeadline" }],
    },
  ],
});
