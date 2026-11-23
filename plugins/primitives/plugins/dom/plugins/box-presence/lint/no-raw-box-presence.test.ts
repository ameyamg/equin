import rule from "./no-raw-box-presence";
import { createRuleTester } from "@plugins/framework/plugins/tooling/plugins/lint/core/testing";

const ruleTester = createRuleTester();
const FILE = "/repo/plugins/foo/web/components/x.ts";

ruleTester.run("no-raw-box-presence", rule, {
  valid: [
    { code: `const shown = generatesBox(el);`, filename: FILE },
    { code: `const first = range.getClientRects()[0];`, filename: FILE },
    {
      code: `const rects = [...range.getClientRects()].filter((r) => r.height > 0);`,
      filename: FILE,
    },
    { code: `const n = items.length;`, filename: FILE },
  ],
  invalid: [
    {
      code: `const hidden = el.getClientRects().length === 0;`,
      filename: FILE,
      errors: [{ messageId: "noRawBoxPresence" }],
    },
    {
      code: `if (anchor?.getClientRects().length) f();`,
      filename: FILE,
      errors: [{ messageId: "noRawBoxPresence" }],
    },
    {
      code: `const shown = (el as Element).getClientRects().length > 0;`,
      filename: FILE,
      errors: [{ messageId: "noRawBoxPresence" }],
    },
  ],
});
