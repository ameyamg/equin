import rule from "./no-signal-zero-probe";
import { createRuleTester } from "@plugins/framework/plugins/tooling/plugins/lint/core/testing";

const ruleTester = createRuleTester();
const SERVER = "/repo/plugins/foo/server/internal/reap.ts";

ruleTester.run("no-signal-zero-probe", rule, {
  valid: [
    { code: `isProcessAlive(pid);`, filename: SERVER },
    { code: `process.kill(pid, "SIGTERM");`, filename: SERVER },
    { code: `process.kill(-pgid, 9);`, filename: SERVER },
    { code: `child.kill(0);`, filename: SERVER },
  ],
  invalid: [
    {
      code: `process.kill(pid, 0);`,
      filename: SERVER,
      errors: [{ messageId: "probe" }],
    },
    {
      code: `process.kill(-pid, 0);`,
      filename: SERVER,
      errors: [{ messageId: "probe" }],
    },
    {
      code: `process.kill(pid, "0");`,
      filename: SERVER,
      errors: [{ messageId: "probe" }],
    },
  ],
});
