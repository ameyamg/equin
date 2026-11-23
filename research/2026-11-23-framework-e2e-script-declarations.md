# E2e scripts declare what they are

## Context

546 files sit under `plugins/**/e2e/`: pass/fail tests, tools (screenshots,
diffs, leak tests, film renders, perf profiles) and helpers (barrels,
`support/`, `internal/`, harness libraries). Nothing in code tells them apart,
and only some tests are safe to run unattended — others file real reports,
need real sign-ins or Google Maps, assert timing, are heavy, mutate shared
state, or need a native helper. A future runner in main's test pipeline must
select by declaration, never by name pattern (`*-verify.ts`, `finish()` calls
are unreliable). This change adds the declaration and classifies every script;
it does not run anything.

## Design

### A runnable script declares itself, in its own file

```ts
import { e2eScript } from "@plugins/framework/plugins/tooling/plugins/e2e-harness/core";

export const e2e = e2eScript({
  kind: "test",                 // "test" (pass/fail verdict) | "tool" (produces artifacts)
  run: "auto",                  // or { manual: ["timing", …], why: "…" }
  writes: true,                 // writes app data → needs a writable build (never main)
});
```

- Types in `e2e-harness/core` (runtime-neutral; every `e2e/` may import `core`).
  `run` is `"auto" | { manual: readonly [ManualReason, ...ManualReason[]]; why: string }`;
  `ManualReason` is a closed list: `external-effects`, `accounts`, `timing`,
  `heavy`, `stateful`, `native-helper`, `interactive` (needs arguments / a human).
  A wrong value is a **tsc error**.
- In the file, not a manifest: a move or rename carries the declaration, and a
  reviewer sees it next to the code it describes.

### A helper is derived, never declared

A helper is a module other code imports. The check computes it from the import
graph: an `e2e/` module is a **helper** iff another file imports it (static,
dynamic or type-only, relative or through a barrel), or it is the folder's
barrel (`e2e/index.ts`, which barrel purity forbids from holding a `const`
anyway). Declaring "helper" would be a second copy of a fact the code already
states — and could disagree with it.

### `e2e-harness:scripts-declared` (check, tree scope)

For every module under a plugin's `e2e/` (`isE2eScriptPath`):

1. imported by another file (or the barrel) → must NOT declare (a runnable
   script that is imported runs its body in its importer);
2. imported by nobody → must declare exactly one top-level
   `export const e2e = e2eScript({ … })` whose argument is an object literal of
   literals (so it is readable without executing the script — importing a
   script runs it);
3. a missing, duplicated or non-literal declaration → check error naming the file
   and the fix.

The static reader (`readE2eDeclaration(ts, sourceFile)`) lives next to the
check and returns the parsed declaration; it is what a future runner reuses
(moved to a barrel then). Parsing reuses `parsedTsSource` / `listCandidateSources`
from `checks/core`, as `crawlable:pages-declared` does.

### Classification of every existing script

Inventory the runnable set via the check's own graph, classify each with
subagents (reading the script: assertions vs artifacts, writes, external
effects, accounts, timing thresholds, weight, statefulness, native helpers,
required arguments), and insert the declarations mechanically from the
resulting table. When in doubt: `manual`, `writes: true`.

## Files

- `plugins/framework/plugins/tooling/plugins/e2e-harness/core/internal/declaration.ts` (+ barrel export)
- `plugins/framework/plugins/tooling/plugins/e2e-harness/check/scripts-declared.ts` (+ test, + `check/index.ts`)
- `plugins/framework/plugins/tooling/plugins/e2e-harness/CLAUDE.md` — the declaration section
- root `CLAUDE.md` "Repeatable flows" bullet — declare it
- every runnable `plugins/**/e2e/*.ts` — one declaration line block

## Verification

- unit test for the reader + graph verdicts (`./equin test` on the plugin)
- `./equin check e2e-harness:scripts-declared` green; `./equin check`; `./equin build`
- spot: `./equin run` of one declared script still runs.

## Revisions after review

- `target` added (`"build"` | `{ composition }` | `"none"`); `satisfies E2eScript`
  instead of a runtime helper; the zod schema in `core` is the one definition
  (type via `z.infer`, re-validated by the check).
- Imports come from plugin-records' module graph (`fileSetImports`, static +
  dynamic), never a hand resolver (`import-scan-safety/no-hand-import-resolution`).
  The graph erases type-only edges, so a module with no top-level executable
  statement is a library (helper) by construction.
- A module loaded by path (film's bundled page entries) declares
  `{ kind: "helper", why }`; `*.test.ts` under `e2e/` is an importer, never a script.
- Cross-field rules: `openDeployDb` ⇒ `writes: true`; `target: "none"` ⇒ `writes: false`.
- Classification policy: leaving rows in the script's OWN deploy does not make
  it manual (the deploy is the agent's throwaway); depending on pre-existing
  data (hardcoded ids) or on shared state (the prototypes dir, the checkout) is
  `stateful`.
- Follow-up, not here: `apps/desktop/fullscreen-budget`'s machine job runs
  `fullscreen-switch-budget.ts` by a hard-coded path with `--file-reports`; it
  could read the declaration once a runner exists.
