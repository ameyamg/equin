# Declared refusals: an undeclared 4xx is reported like a 5xx

Task: task-1795653432-5x29hx (decision D33, dec-1795652368-ensz3z, option A).
Status: **stage 0 shipped** (the 4xx counter). Stages 1–3 are waiting for the
user, once stage 0 has a few days of numbers. The full design is a structural
change larger than medium.

## Context

Only 5xx and schema-validation 400s reach Reports
(`reports/endpoint-errors/web/internal/endpoint-error-reporter.ts`, client side,
filtering `endpointErrorSink`). A 4xx that comes from a real bug, like the tab
recorder's "404: no recording … is being uploaded here", goes unseen. The user
chose this rule: each endpoint declares the refusals it gives on purpose, and
any other 4xx is reported.

## Measured (2026-11-26)

- **There is no HTTP access log.** `~/.equin/worktrees/<wt>/logs/` has no
  per-request channel. `~/.equin/logs/gateway/*.log` holds process stdio and
  gateway warnings, with no request statuses. No DB table records request
  statuses (`information_schema` search: none). The `http` entry span
  (`recordEntrySpan`) records duration, not status. So **today's 4xx/day by
  endpoint can't be measured from what exists**. It needs instrumentation
  (step 0 below).
- Reports in the last 30 days whose message is `HTTP 4xx from …`: 5 rows / 25
  occurrences (website-visitor 403 ×17, website-visitor 400 ×6, server-caught
  403 ×2).
- Refusal sites in code (non-test `.ts`):
  - `new HttpError(` 426 sites in 169 files: 404 ×137, 400 ×88, 409 ×27, 413 ×4,
    403 ×2, 422 ×1, 5xx ×17, and the rest multi-line.
  - 282 of these are in 122 files that hold a handler (`implement` /
    `implementMachine` / `rawEndpointHandler` / `machineHandler`). **144 are in 47
    helper-only files** that are shared across endpoints (page editor's
    `parse-block-data`, `page-id`, `ancestry`; tag-tree `repo`;
    agent-access `policy`; code-explorer `resolve-worktree-path`; …).
  - 111 raw `status: 4xx` Responses built by hand (raw handlers, central).
  - 439 `defineEndpoint` declarations.

## Design (highest rung)

1. `defineEndpoint({ …, refuses: { 404: "the block was deleted", 409: "two edits raced" } })`.
   This is a closed map from status to the reason it is deliberate, read as a
   literal type.
2. The handler context gains `refuse(status, message)`. Its `status` is
   `keyof refuses`, so an undeclared status is a **tsc error** at the throw
   site (rung 2).
3. `HttpError` loses its 4xx spelling: `status` narrows to the 5xx literal
   union, so `new HttpError(404, …)` stops compiling (rung 1 for the
   free-floating throw). Helpers stop throwing HTTP. They return a
   discriminated result (`{ kind: "not-found" }`; api-design: "maps to an HTTP
   status — return the union the handler translates"), or take a typed
   `Refuse<404 | 409>` from the handler that calls them.
4. Raw handlers (`rawEndpointHandler` / `machineHandler`, central) get the same
   `refuse`. A hand-built `Response` with a 4xx status is checked at the brand
   against `refuses` (rung 4, a runtime assert). The comment says
   `Compensates for: a raw handler builds its own Response`.
5. Reporting is server side, in `endpointHandler`'s catch and the raw brand. An
   undeclared 4xx is answered as before **and** filed as a `server-caught`
   crash whose subject is `<route> <status>`, so there is one report per route
   and status. The client filter stays as it is: it never sees a declared
   refusal as a bug, and server-side reporting also covers CLI, MCP and central
   callers.

## Why stopped

To reach rung 1/2 every refusal site has to move: about 426 throws in 169
files, 47 of them shared helpers that need their result type changed, 111 raw
statuses, and `refuses` on roughly 150+ of the 439 declarations. A
runtime-only version (rung 4) still has to declare every endpoint that refuses
before it can ship, or every existing 4xx floods Reports. So none of it is
"medium". There is no smaller version that still meets the rule the user
chose.

## Proposed staging (if approved)

0. **Measure first** — shipped. http-router's `createRequestHandler` gains an
   `onRefused` observer that gets every 4xx with its matched route key, or
   `null` when no route matched. server-core's `bin/serve.ts` wires it to
   `debug/http-refusals`' `recordRefusal`, which writes one line per 4xx to the
   `http-refusals` log channel, with the first 300 characters of the body.
   This covers `implement`, raw handlers and the principal gate's refusals.
   It does not cover WebSocket upgrade refusals, central's routes, or 4xx the
   gateway answers itself (main's agent-write 403s are the backend's and are
   counted).
   Read the counts per route and status with:
   `jq -r '.line | fromjson | "\(.status) \(.route // ("(unmatched) " + .method + " " + .path))"' ~/.equin/worktrees/<wt>/logs/http-refusals.jsonl | sort | uniq -c | sort -rn`
   (main: `<wt>` = `singularity`).
1. **Primitive.** Add `refuses` + `refuse` + the server-side report of
   undeclared statuses, reporting only for routes that declare `refuses`
   (opt-in while migrating). Narrowing `HttpError` waits for the last phase.
2. **Migrate by umbrella.** page editor (largest helper set), tasks,
   conversations, code-explorer, the rest. Each one is a push that declares its
   refusals and converts its helpers to results.
3. **Close.** Narrow `HttpError` to 5xx (tsc). Reporting becomes the default
   for every route, with no opt-in.

## Verification (per phase)

- tsc: an undeclared `refuse(404)` fails to compile (a type test in
  `endpoints/core`).
- Unit: an undeclared 4xx from a handler files one report and still answers
  the status. A declared one files nothing.
- Compare the `http-refusals.jsonl` counts before and after each phase against
  the reports filed.
