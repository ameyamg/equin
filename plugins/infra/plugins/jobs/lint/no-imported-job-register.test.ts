/**
 * Tests for `no-imported-job-register` — a type-aware rule: each case is
 * linted as a virtual `case.ts` beside this file, type-checked under an
 * inferred project (`createTypedRuleTester`). The imported tokens come from an
 * augmentation of `node:os`.
 */

import { setDefaultTimeout } from "bun:test";
import { createTypedRuleTester } from "@plugins/framework/plugins/tooling/plugins/lint/core/testing";
import rule from "./no-imported-job-register";

// The first case pays for building the inferred project's program.
setDefaultTimeout(60_000);

const LINT_DIR = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const VIRTUAL_CASE = "case.ts";
const FILENAME = `${LINT_DIR}/${VIRTUAL_CASE}`;

const JOB = `{ register(): void; enqueue(input: unknown): Promise<unknown>; inFlight(keys: string[]): Promise<Set<string>> }`;
// The inferred project resolves no \`@plugins/…\` alias, so the imported
// tokens are declared by augmenting a module it does resolve (node's types).
const PRELUDE = `
import { importedJob, importedWatcher } from "node:os";
declare module "node:os" {
  export const importedJob: ${JOB};
  export const importedWatcher: { register(): void };
}
declare const localJob: ${JOB};
`;

const valid = (code: string) => ({ filename: FILENAME, code: PRELUDE + code });
const invalid = (code: string) => ({
  filename: FILENAME,
  code: PRELUDE + code,
  errors: [{ messageId: "imported" as const }],
});

const ruleTester = createTypedRuleTester({
  dir: LINT_DIR,
  cases: [VIRTUAL_CASE],
});

ruleTester.run("no-imported-job-register", rule, {
  valid: [
    valid(`localJob.register();`),
    valid(`importedWatcher.register();`),
    valid(`void importedJob.enqueue({});`),
  ],
  invalid: [
    invalid(`importedJob.register();`),
    invalid(`async function f() { await importedJob.register(); }`),
  ],
});
