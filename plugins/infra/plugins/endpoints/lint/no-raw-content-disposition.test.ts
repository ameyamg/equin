/**
 * Tests for the `endpoints/no-raw-content-disposition` lint rule: the
 * Content-Disposition header is spelled only by contentDisposition().
 */

import rule from "./no-raw-content-disposition";
import { createRuleTester } from "@plugins/framework/plugins/tooling/plugins/lint/core/testing";

const ruleTester = createRuleTester();

const FILE = "/repo/plugins/x/server/internal/route.ts";
const c = (code: string) => ({ filename: FILE, code });

ruleTester.run("no-raw-content-disposition", rule, {
  valid: [
    c(
      `const h = { "content-type": "video/mp4", ...contentDisposition("inline", name) };`,
    ),
    c(`const s = "content-type";`),
    c(`const s = \`content-disposition: \${x}\`;`),
  ],
  invalid: [
    {
      ...c(`const h = { "content-disposition": "inline; filename=" + n };`),
      errors: [{ messageId: "raw" }],
    },
    {
      ...c(`const h = { "Content-Disposition": "attachment" };`),
      errors: [{ messageId: "raw" }],
    },
    {
      ...c(`headers.set("Content-Disposition", v);`),
      errors: [{ messageId: "raw" }],
    },
    {
      ...c("headers.append(`content-disposition`, v);"),
      errors: [{ messageId: "raw" }],
    },
  ],
});
