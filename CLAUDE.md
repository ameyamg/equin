# equin

equin is a platform where agents build and maintain large apps on their own.

- **Plugins all the way down.** Every feature is a self-contained plugin that any app can reuse.
- **Self-evolving.** The app is developed from inside itself: the agent manager runs many sessions in parallel, and background agents fix, push and update it.
- **Vision: a shared plugin marketplace.** Each user's OS is their own composition of marketplace plugins. Today's apps (agent manager, pages, mail, places, music, …) are just one person's set among many.
- **Real users.** People already fork it, and each change ships to an app someone uses every day.

How the vision unfolds: [`docs/vision.md`](docs/vision.md).

## Hard rules

- **NEVER `./equin push`** unless instructed — the user reviews first. "push", "publish", "ship" all mean `./equin push`.
  - A Dependencies (or legacy Toolchain) upgrade task counts as instruction; its text says when (`plugins/infra/plugins/deps/plugins/updates`).
- **NEVER `git commit` / `git push`** yourself.
- **NEVER `--from-main`** without explicit approval in this conversation, for this push. On main with no worktree branch: stop and ask.
- **Rebase, never merge**: `git rebase origin/main`. Never `git merge origin/main`, never `git reset` a branch onto main. (Exception: `./equin upstream merge`.)
- **NEVER run `drizzle-kit generate` or the migration runner** — `./equin build` does it.
- **NEVER `./equin start` / `stop`** (the gateway launchd service) unless the user asks.
- **Never build or redeploy main** — it auto-builds when main advances. Don't report it as a caveat.
- **Review diffs against the merge-base**: `git diff $(git merge-base HEAD main)`.
- **STOP on unexpected failures** — surface and ask; never route around (e.g. curl after a failed MCP call).

## Workflow

1. Design first for most features: the project `plan` skill (never `EnterPlanMode`).
2. Edit in your worktree.
3. `./equin build` — migrations, frontend, server, gateway registration.
   - Run it with `run_in_background: true` and **end your turn**; it re-invokes you on exit (~10 min).
   - **Subagents** must not end their turn: background it, then `./equin await <op>` in the foreground (exit 0 ok, 1 failed, 70 still running → call again).
4. Your build is served at `http://<worktree>.localhost:<port>` (`./equin url` prints the real port). Always write the `http://` so it's clickable.
5. `./equin push -m "…"` once the user approves.
   - `push` first runs the tests your change affects and refuses a change that newly breaks one.
   - A push fixing a report: `--fixes-report <report-id>` (repeatable).

Without write access to the remote, `push` lands on local `main`. Main's auto-build watches it ([`git/remotes`](plugins/infra/plugins/git/plugins/remotes/CLAUDE.md)).

`./equin check [<id>]` (`--list` for ids) and `./equin test` run in the foreground. If one exits 70, call the `./equin await <op>` it prints.

Before a task, read the matching skill: `plan`, `api-design`, `create-app`, `debug`, `perfs-investigation`, `theme`, `css`.

## Architecture

Every feature is a **plugin**; the core is thin plumbing joined by slots. Read before designing one:

- Frontend: [`web-sdk/CLAUDE.md`](plugins/framework/plugins/web-sdk/CLAUDE.md)
- Backend: [`server-core/CLAUDE.md`](plugins/framework/plugins/server-core/CLAUDE.md)

```
plugins/{name}/
  web/ server/ central/   # runtimes
  core/                   # public API, importable cross-plugin
  shared/                 # private, web↔server inside this plugin only
  machine/ cli/ e2e/ provision/ data-dirs/ deps/  # other barrel folders
  lint/ check/ exhibits/ bin/ scripts/ facet/ vite/ prewarm/ python/ rust/ exempt/ guard/ login-services/  # leaf folders, never imported
  plugins/                # child plugins
gateway/     # Go namespace proxy (gateway/CLAUDE.md)
sidequests/  # unrelated side projects
research/    # research docs and plans
```

### Design rules

- **Collection–consumer separation.** A consumer of an open set (facets, checks, …) uses only the collection's generic API — never names a contributor. For a **closed list** (a dropdown's options, an allowlist), plain data in `core/` beats a slot.
- **Group related plugins under an umbrella** (`plugins/<umbrella>/plugins/<child>/`). Before adding to `infra/` or `primitives/`, ask whether a more specific umbrella fits (it usually does). Never a new top-level child there.
- **Search before writing** a type, hook, helper, fixture or slot: start with the plugin's `CLAUDE.md` autogen reference.

### Boundary rules

Enforced by `./equin check boundary-rules` and `plugin-boundaries` — the errors explain. The model:

- One barrel per runtime: `plugins/<name>/<runtime>/index.ts` is the only cross-plugin entry. No deep paths, no `api.ts`.
- Barrels hold only imports, re-exports, types and one `export default { … } satisfies PluginDefinition`.
- Which folder may import which: the `folders` table in `boundaries/core/boundary-config.ts`. Applies inside a plugin too.
- No cross-plugin `shared/`, no re-exports of another plugin, no cycles (type-only imports count).
- Never register a plugin by hand — create `<runtime>/index.ts` and build.
- New check: `plugins/<name>/check/index.ts` default-exports `Check | Check[]` (id `<plugin>:<id>`), auto-discovered. Lint rules: `lint/index.ts` ([`lint`](plugins/framework/plugins/tooling/plugins/lint/CLAUDE.md)).
- Exemptions are declared by the exempted plugin in `exempt/index.ts` — never an allowlist in the rule. `./equin exempt list`.

Details: [`boundaries`](plugins/framework/plugins/tooling/plugins/boundaries/CLAUDE.md), [`plugin-boundaries`](plugins/framework/plugins/tooling/plugins/checks/plugins/plugin-boundaries/CLAUDE.md), [`exempt`](plugins/framework/plugins/tooling/plugins/exempt/CLAUDE.md).

## Coding style

**Prefer the clean design over the hacky one, even when it's more work.** Ask: what primitive would make this *and* future cases trivial?

- **Reuse existing concepts** before adding a type, hook, slot, config key, table or term.
- **No polling.** Use watchers, `LISTEN/NOTIFY`, WebSocket, `network/live`, `events`/`jobs`. No change signal upstream → a scheduled `defineJob`, documented.
- **Fail loudly.** Never swallow errors or add fallbacks that mask a broken assumption.
  - `await p` · `.catch(err => { if (err instanceof X) …; else throw err })` · `void p` (intentional).
  - Never `.catch(() => {})` or `.catch(console.error)`.
- **Failure is a type.** Throw, or return a discriminated result — never `null`/`[]`/`0` a caller can mistake for empty success. See the `api-design` skill.
- **Not-known-yet is a state, not a value.** Render loading — never an empty list or zero that later reverses. Reads return a state (`useLive`, `useConfigResult`). `Button` auto-pends and `DataView` has `loading`, so don't hand-roll pending state.
- **Live state goes through `network/live`.**
  - Collection: `liveCollection` + `serveCollection` (bounded: `limit` / `maxLimit`). Value: `liveValue` + `serveValue`.
  - Read with `useLive`. No request/response reads — endpoints are for writes.
  - Never copy `defineResource` / `useResource` / `useQuery` as precedent. See [`live/CLAUDE.md`](plugins/network/plugins/live/CLAUDE.md).
- **Ordering is never a number** on a slot contribution — use `defineRenderSlot` and its reorder layout.
- **Domain record lists are DataViews** (`plugins/primitives/plugins/data-view`), never a `.map()` of rows. Another list of the same records (trash, archive) is a `DataViewSwitcher` source.

### Fix the cause, not the symptom

Ask why it was possible at all. A targeted fix at one call site leaves the rest exposed.

**Beware fixes that hide the issue.** The symptom goes away, the cause stays, and the next occurrence is harder to trace:

- **A deadline on a slow op**: find out why it is slow (the `perfs-investigation` skill).
- **A retry on a failing op**: find out why it fails. A retry turns a deterministic bug into a flaky one.
- **A cache over a slow path**: find out why the path is slow first. A cache is fine as a complement once the path is sound, never as the thing that hides the slowness.
- **Raising a limit, cap or timeout because it got hit**: find out why the work outgrew the bound.
- **A guard around an API that stays easy to misuse** (a lint, check, assert, per-op threshold or report exception): the next caller writes the same bug in a spelling the guard doesn't match. Change the API.
- **A second fix for a report already fixed**: first say why the earlier fix didn't hold (the report's task lists its earlier fixes). The answer is usually one level up — the gate, the primitive, the default — not the next instance.
- These are examples, not an exhaustive list. The rule: any fix that makes a symptom disappear without explaining its cause is suspect.
- A deadline or retry is still right as a *bound* around something you don't control (a network peer, a third-party API), never as the fix for your own code.

Take the **highest rung** that can express the constraint, even if it churns call sites:

1. **Inexpressible** — rethink the API until the wrong thing has no spelling: drop the parameter, derive the value, take the data instead of a callback, delete the concept.
2. **Type error** — tsc rejects it.
3. **Check / lint error** — cross-file invariants.
4. **Loud runtime failure** — an assert at the boundary.
5. **Documentation** — the weakest. Never when a rung above fits.

**Rung 1 is the fix; rungs 2–5 are guards.** A guard keeps the API and catches its misuse: a workaround for an API that lets the mistake be written. Use one only when the API is right and the rule can't be designed away, or as a stopgap with a task for the redesign. Every guard says which, in its message or comment: `Compensates for: <the API flaw> (task-…)`, or `No flaw: <why the API can't express it>`. A guard shaped like the incident (it bans the spelling you just hit while the next one compiles) counts only as documentation.

**Don't memorize gotchas.** Hit a footgun? Surface it or `add_task` it, to be fixed on this ladder — no memory file.

## Tools & environment

- **Search:** never unbounded `find` (has crashed macOS) — `rg --files -g`, `fd`, or `find -maxdepth`. `rg` is recursive; never pass `-r` (it means `--replace`).
- **Scratch files** go in `$EQUIN_SCRATCH`, never a fixed `/tmp/<name>`.
- **Scripts:** `./equin run <file>.ts`, never bare `bun <file>.ts`.
- **Subagents:** pass `model: "opus"` for real work; `model: "sonnet"` only for lookups and mechanical refactors.
- **On breakage**, rebase first (`git fetch origin main && git rebase origin/main`) — it may be fixed.
- **Ports:** never write a port in code — `pagePort` / `servedGatewayPort` / `gatewayPort` (`infra/launcher/gateway-port`). Main is `http://equin.localhost:<port>`.
- **Logs:** `~/.equin/worktrees/<wt>/logs/<channel>.jsonl`; emit from the browser with `clientLog` ([`debug/logs`](plugins/debug/plugins/logs/CLAUDE.md)).

### MCP tools

- `add_task` — whenever the user says "add a task" (never `TaskCreate`).
- `query_db` — read-only SQL, your worktree DB by default (`database: "equin"` for main).
- `read_page` / `edit_page` / `write_agent_note` — write to the **shared** instance (main). Only inside agent-authored blocks (`<agent-inline>`, `<agent-page>`); a page's own prose is read-only.
- When the user says **"Exit"**: `exit_clean`, or `flag_raise({ reason })` if something needs them.

### Testing

`./equin test [paths]` is the only way. It takes paths only, no flags. Never bare `bun test` / `vitest`.

- `*.test.ts(x)` beside its source = pure logic; `web/__tests__/` = jsdom/React.
- Own tests import by relative path. Reusable helpers go in `<runtime>/testing/index.ts`.
- bun:test rejections: `expect(p).rejects.toThrow()` **without** `await`. Under vitest, `await` it.
- **A test failing on main is never filed as a task.** `./equin test` says per file whether it already fails on main and names main's `test-failing` report. Fix it only if it's in your way, with `--fixes-report <id>` ([`failing-report`](plugins/debug/plugins/tests/plugins/failing-report/CLAUDE.md)).
- jsdom: pinned clock, `en-US`, `UTC`. Details: [`test-layout`](plugins/framework/plugins/tooling/plugins/test-layout/CLAUDE.md).

### Driving the app

`./equin build` first — scripts target this checkout's build. **Main is read-only** for agents (403 on writes).

**`https://equin.ai` is not a test target.** Reproduce a visitor report on your own build (`./equin build --composition website`). Open equin.ai only for what only the deployed site shows, or to confirm a deploy. Never point `demo-error-reported.ts` / `slow-load-reported.ts` at it without a reason: they file real visitor reports.

| Need | Use |
|---|---|
| Show the user a UI change | `register_before_after` MCP after build; cite the `ba-…` id |
| Explore interactively | `browser_*` MCP tools ([`mcp/browser`](plugins/infra/plugins/mcp/plugins/browser/CLAUDE.md)) |
| Screenshot / click & verify | `plugins/framework/plugins/tooling/plugins/e2e-harness/e2e/screenshot.ts --path … --click … --out "$EQUIN_SCRATCH/x"` |
| One component alone | `plugins/plugin-meta/plugins/exhibits/e2e/exhibit-shot.ts --id <group/name>` ([`exhibits`](plugins/plugin-meta/plugins/exhibits/CLAUDE.md)) |
| Prototype vs real app | `plugins/apps/plugins/prototypes/plugins/compare/e2e/compare-diff.ts` ([`compare`](plugins/apps/plugins/prototypes/plugins/compare/CLAUDE.md)) |
| Memory leaks | `plugins/framework/plugins/tooling/plugins/e2e-harness/e2e/leak-test.ts` |
| Resume a failed script | `browser_attach`, rerun with `--attach <ticket>` |

Run scripts with `./equin run <path>`. Never pass your own worktree URL by hand: in an agent session it resolves to main. `--url` is only for a deploy you didn't build.

A repeatable flow is `plugins/<path>/e2e/<name>.ts` (never `*.test.ts`) and declares `export const e2e = { … } satisfies E2eScript`.

Flags, repeatable flows and the shared helpers: [`e2e-harness/CLAUDE.md`](plugins/framework/plugins/tooling/plugins/e2e-harness/CLAUDE.md). Claude-in-Chrome is the user's own browser — only when you need their sign-ins or screen.

### Upstream (forks)

A checkout cloned from someone else's repo has that repo as **upstream** (read-only).

- A daily job on main files a report when upstream has new commits. The report's Investigate button creates the task.
- An update is an ordinary task: run `./equin upstream merge` in a worktree, resolve conflicts, build, review. The user lands it with `push`.
- The canonical repo has no upstream. Details: [`upstream`](plugins/upstream/CLAUDE.md).

### UI work

- **New app → prototype first** ([`prototypes/CLAUDE.md`](prototypes/CLAUDE.md)). Implement the app only after the user reviews the prototype. Read that doc before writing or implementing one. Start from `_template/`; don't open other prototypes.
- **UI polish** → read [`sidequests/ui-mastery/`](sidequests/ui-mastery/CLAUDE.md) first.

## Answer format: `<go>`

Wrap each part of your answer the user could pick as their reply in `<go>…</go>`.

```
Should I <go>implement it</go>? Or <go>file a task</go>?

<go>
- [ ] Follow-up A
- [x] Follow-up B
</go>
```

`- [x]` pre-picks the items you recommend.

- One line = inline chip; multi-line = block. Only picked `- [ ]` lines are sent back.
- Items with columns → a table in `<go>`, each row's first cell `[ ]` / `[x]`. Never repeat it as a checklist.
- One choice per item — never "File the 3 follow-ups".
- A `<go>` in a **user** message is their pick: do it.
  - It may be reworded: act on its text.
  - Items you listed that are missing from it were declined.
  - Text around it is the user's own and wins over it.
  - Unless it's quoted in a question ("why <go>X</go>?"): then answer the question.

Details: [`active-data/go`](plugins/active-data/plugins/go/CLAUDE.md).
------------------------------------

@docs/plugins-compact.md
