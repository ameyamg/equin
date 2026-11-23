/**
 * Tests for `no-unstated-wall-age`: a bare `Date.now()` used as an age or a
 * deadline check — directly or through the binding it initialises — is
 * reported outside browser code; a stored instant, an expiry computed with
 * `+`, `performance.now()` and `wallNow(reason)` are not.
 */

import rule from "./no-unstated-wall-age";
import { createRuleTester } from "@plugins/framework/plugins/tooling/plugins/lint/core/testing";

const ruleTester = createRuleTester();

const MACHINE = "/repo/plugins/foo/machine/internal/run.ts";
const SERVER = "/repo/plugins/foo/server/internal/run.ts";
const err = [{ messageId: "unstatedWallAge" as const }];

ruleTester.run("no-unstated-wall-age", rule, {
  valid: [
    // A stored or logged instant is no age.
    { code: `row.createdAt = Date.now();`, filename: SERVER },
    { code: `const at = Date.now(); write({ at });`, filename: SERVER },
    // An expiry computed for later: judged where it is compared.
    { code: `const expiresAt = Date.now() + ttl;`, filename: SERVER },
    // Awake time and a stated wall-clock read.
    { code: `const ms = performance.now() - started;`, filename: MACHINE },
    {
      code: `const cutoff = wallNow("retention") - TTL_MS;`,
      filename: SERVER,
    },
    // A `let` is reassigned: only its initialiser is judged, so it is not traced.
    { code: `let t = Date.now(); t = 0; f(t - 1);`, filename: SERVER },
    // Browser code is out of scope.
    {
      code: `const age = Date.now() - at;`,
      filename: "/repo/plugins/foo/web/a.ts",
    },
  ],
  invalid: [
    { code: `const age = Date.now() - at;`, filename: SERVER, errors: err },
    {
      code: `const left = deadline - Date.now();`,
      filename: MACHINE,
      errors: err,
    },
    {
      code: `if (Date.now() > deadline) stop();`,
      filename: MACHINE,
      errors: err,
    },
    {
      code: `const fresh = (Date.now() as number) - s.at < FRESH_MS;`,
      filename: SERVER,
      errors: err,
    },
    {
      code: `const t = new Date().getTime() - at;`,
      filename: SERVER,
      errors: err,
    },
    {
      // Through the const it initialises.
      code: `const now = Date.now(); const stale = rows.filter((r) => now - r.at > MAX);`,
      filename: SERVER,
      errors: err,
    },
    {
      // Both readings of an in-process duration.
      code: `const started = Date.now(); work(); log(Date.now() - started);`,
      filename: MACHINE,
      errors: [...err, ...err],
    },
    {
      // A `let` never reassigned is traced like a `const`.
      code: `let now = Date.now(); f(now - 1);`,
      filename: SERVER,
      errors: err,
    },
    {
      // A parameter default used as "now".
      code: `function sweep(now = Date.now()) { return rows.filter((r) => now - r.at > TTL); }`,
      filename: SERVER,
      errors: err,
    },
  ],
});
