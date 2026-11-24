/**
 * `no-raw-single-line-provider`: path exemptions live in the owning plugins'
 * `exempt/index.ts`, so every filename here is flagged.
 */
import noRawSingleLineProvider from "./no-raw-single-line-provider";
import { createRuleTester } from "@plugins/framework/plugins/tooling/plugins/lint/core/testing";

const ruleTester = createRuleTester();

ruleTester.run("no-raw-single-line-provider", noRawSingleLineProvider, {
  valid: [
    {
      code: `import { Line } from "@plugins/primitives/plugins/css/plugins/line/web";`,
    },
    {
      code: `import { cn, useSingleLine } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";`,
    },
  ],
  invalid: [
    {
      code: `import { cn, SingleLineProvider } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";`,
      errors: [{ messageId: "rawProvider" }],
    },
    {
      code: `import { SingleLineProvider as P } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";`,
      errors: [{ messageId: "rawProvider" }],
    },
  ],
});
