/**
 * Tests for `no-registered-partial-fake`: an `{ … } as unknown as T` object
 * literal handed to a registration call — directly or through the `const` it
 * initialises — is reported; a `satisfies` fake, a double cast of a non-literal,
 * and a partial fake that is never registered stay valid.
 */

import rule from "./no-registered-partial-fake";
import { createRuleTester } from "@plugins/framework/plugins/tooling/plugins/lint/core/testing";

const ruleTester = createRuleTester();
const err = [{ messageId: "registeredPartialFake" as const }];

ruleTester.run("no-registered-partial-fake", rule, {
  valid: [
    { code: `const rt = { id: "sdk" } satisfies Rt; Runtime.define(rt);` },
    { code: `Driver.provide(make(t.db as unknown as Db));` },
    { code: `Driver.provide(t.db as unknown as Db);` },
    { code: `const row = { id: 1 } as unknown as Row; render(row);` },
    {
      code: `let rt = { id: "x" } as unknown as Rt; rt = real; Runtime.define(rt);`,
    },
    { code: `Runtime.lookup({ id: "x" } as unknown as Rt);` },
  ],
  invalid: [
    {
      code: `const rt = { id: "sdk" } as unknown as ConversationRuntime;\nRuntime.define(rt);`,
      errors: err,
    },
    {
      code: `Runtime.register({ id: "sdk" } as unknown as Rt);`,
      errors: err,
    },
    {
      code: `HostService.provide({ get: () => 1 } as unknown as Service);`,
      errors: err,
    },
    {
      code: `const s = { run() {} } as unknown as Runtime;\nfunction f() { installSpanRuntime(s); }`,
      errors: err,
    },
    {
      code: `registerHandler({} as unknown as Handler);`,
      errors: err,
    },
    {
      code: `Runtime.define(<Rt>(<unknown>{ id: "x" }));`,
      errors: err,
    },
  ],
});
