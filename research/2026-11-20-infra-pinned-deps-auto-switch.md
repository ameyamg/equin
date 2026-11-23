# Pinned binaries: auto-switch non-blocked pins, roll back on a failed start

## Context

Pinned dependencies (`infra/deps` § Pinned installs: `postgres-binaries`,
`pgbouncer-binary`) never follow main's `bun.lock`. Today every move — even a
patch — waits for a person to run `./equin deps pin <id>` (health row
"Pinned binaries" in attention; after 30 days a flag in the weekly Dependency
upgrades task). A non-blocked switch is already safe by construction (it
installs, moves the pin, restarts nothing), so the person is only a
confirmation step. The real risk the person guarded against is a new binary
that fails at the next start — taking down every worktree's database.

Outcome:
- A non-blocked move is switched automatically when main advances.
- A daemon whose fresh start fails on a newly switched pin falls back to the
  last install that started, in the same start run, and a report is filed.
- The person is only asked for what code cannot decide: a blocked move
  (Postgres major — flagged at the first weekly run, not after 30 days) and a
  switch that was rolled back.

## Design

### 1. Engine (`plugins/infra/plugins/deps/deps/internal/`)

**Last-good hold.** New holder `<holder>-good` (beside `<holder>` and
`<holder>-running`, `pin.ts`), written by the start path only once the daemon
answers. It is the rollback target, and keeps those bytes from the sweep
(`sweep.ts` honours every hold).

**`startPinned(dep, { exec, log, start })`** — new, in `pin.ts`, replaces the
`pinnedDep` + `holdRunningDep` pair in both start scripts:
1. `pinnedDep` → the pinned install; `holdRunningDep` on it (as today, before
   the start).
2. `await start(ready)` (the caller's launch + readiness wait: Postgres's
   `pg_ctl -w` + `ensureClusterState`, PgBouncer's `waitReady`).
3. Success → `holdDep(ready, "<holder>-good")`; return `{ kind: "started" }`.
4. Failure and a `-good` install exists that is **not** the pinned one →
   record the failed identity (§3), `holdDep(good, holder)` (pin back),
   `holdRunningDep(good)`, `await start(good)` once; return
   `{ kind: "rolled-back", from, to, error }`. The caller files the report.
   If the retry fails too, throw (both errors) — the gateway's watchdog
   files service-down as today.
5. Failure with no different `-good` → rethrow (unchanged behaviour).

Adoption: the first successful start after this lands writes `-good`, so
existing machines get a rollback target without migration.

Timing: two `pg_ctl -t 30` attempts fit the gateway's 5 min
`defaultStartCommandTimeout` (`gateway/supervisor.go:200`).

**`autoSwitchPin(dep, { root, exec, now })`** — new, beside `pinDep`: when
`pinStatus` says `differs`, `blocked === null`, and the declared identity is
not the recorded failed one → `pinDep(dep, exec, { root })`. Returns
`switched | blocked | failed-before | current`.

### 2. Who switches (`plugins/infra/plugins/deps/plugins/pin-drift/machine/`)

- `reaction.ts` (the `refs/heads/main` ref reaction, main only): before
  `recordPinReviews`, run `autoSwitchPins(now)` = `autoSwitchPin` for every
  pinned dep against `getMainRepoRoot()`, when the config allows.
- The weekly decision source (`decisions.ts`) runs it too, as the backstop for
  a main advance missed while the backend was down.
- Deterministic code; no agent ever runs `deps pin`.
- Nothing restarts: the switch applies at the pin's `appliesAt` (next fresh
  start), unchanged. Restarting the shared cluster proactively is out of scope.

### 3. Recorded state (`pin-review.ts`, `state/deps-pins/<id>.json`)

Add `rolledBack: { identity, version, at, error } | null` to the record:
written by `startPinned` on a rollback, cleared when main declares another
identity (or by `./equin deps pin <id>`, an explicit retry). While it names
the declared identity, `autoSwitchPin` skips it — a failed version is never
retried automatically (the gateway follow's "a key already tried is never
retried" rule, `gateway-drift/cli/internal/follow.ts`).

`reviewPin` gains decision `"rolled-back"` (due at once) and a blocked lag is
due at first sight (no 30-day bound — nothing else will close it). A
non-blocked lag with auto-switch on is `"switching"` (never due).

### 4. Report

New kind `pinned-dep-rollback` (`ReportKind`, pattern of
`gateway-drift/server/internal/restart-failed-kind.ts`), filed from the start
script with `fileReportFromProcess` (`reports/outbox/file/core`, as
`debug/boot-events/machine/internal/boot-crash.ts`). Payload: dep id, from/to
versions, the start error. Its task text: what failed, that the machine runs
the previous version, and `./equin deps pin <id>` to retry after a fix.

### 5. Config

`defineConfig({ name: "deps-pins", fields: { autoSwitch: boolField({ default: true }) } })`
in pin-drift `core`, registered with `ConfigV2.Register` in its `machine`
barrel, read with `getConfig` in `autoSwitchPins` (start scripts don't read it:
rollback is always on). Off → today's manual behaviour.

### 6. Health row (`pin-drift/web/internal/pin-health.ts`, detail component)

| State | Level | Text |
|---|---|---|
| same, running same | ok | Up to date with main |
| same, running older (switched, awaiting restart) | ok (note) | "pgbouncer-binary 1.24.1 at next start" |
| differs, not blocked, auto-switch on | ok (note) | "switching to 18.6.0" (transient) |
| differs, not blocked, auto-switch off | attention | today's text |
| rolled back | attention | "postgres-binaries 18.6.0 failed to start — back on 18.1.0" |
| differs, blocked | attention | "→ 19.0.0 blocked" (stay ⇒ ok, as today) |
| unreadable | unknown | as today |

Detail pane: rolled-back shows the error and the retry command.

### 7. Weekly decisions (`decisions.ts`)

Emit only: blocked moves (from the first run, options = stay / file a
migration-design task) and rolled-back switches (options = investigate /
stay). Non-blocked lags produce none while auto-switch is on.

## Critical files

- `plugins/infra/plugins/deps/deps/internal/pin.ts`, `pin-review.ts`, `deps/index.ts`
- `plugins/database/plugins/embedded/scripts/start.ts` (`freshStart`), `scripts/pinned-binaries.ts`
- `plugins/database/plugins/pgbouncer/scripts/start.ts`, `scripts/pinned-binary.ts`
- `plugins/infra/plugins/deps/plugins/pin-drift/{core,machine,web}/…`
- new report kind (server) + core payload in pin-drift
- Docs: `infra/deps/CLAUDE.md` § Pinned installs, `pin-drift/CLAUDE.md`,
  `database/embedded/CLAUDE.md` ("nothing restarts" note stays true).

## Verification

- Unit (`./equin test plugins/infra/plugins/deps`): `startPinned` with a temp
  store — success writes `-good`; failure with a different `-good` pins back,
  starts it, records `rolledBack`; failure with none rethrows; retry failure
  throws both. `autoSwitchPin`: switches non-blocked, skips blocked and a
  recorded failed identity. `reviewPin` decisions (blocked due at once,
  rolled-back, switching). `pin-health.test.ts` for the new table rows.
- Integration on a throwaway store: start script with a fake `start` that
  fails for one identity.
- `./equin build`; row shows "Up to date with main" on this machine;
  `register_before_after` for the row states via exhibits if added.
- No live daemon restart in testing (shared cluster) — rollback exercised by
  tests only.
