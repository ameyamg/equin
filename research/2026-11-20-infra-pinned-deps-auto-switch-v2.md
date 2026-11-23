# Host daemon binaries follow main (v2)

Supersedes `2026-11-20-infra-pinned-deps-auto-switch.md` (v1: keep the pin,
switch it automatically). v2 removes the pin instead.

## Context

The embedded Postgres (`postgres-binaries`) and PgBouncer (`pgbouncer-binary`)
run from a machine-local **pin** (a hold file in the deps cache) that only
`./equin deps pin <id>` moves. The weekly upgrade agent bumps their npm
packages in `bun.lock` but never the pin, and never starts the new binary
before pushing — so every bump needs a second, manual decision, surfaced by
the Pinned binaries health row and a 30-day review.

User's model, adopted here: **main is the pin.** The upgrade agent is the one
decision — it moves the package only after proving the new binary starts —
and the machine runs what main declares from the daemon's next start, falling
back to the last install that started if it does not.

## Design

### 1. The machine runs main's declaration (`infra/deps` engine)

The gateway runs the daemons' start scripts from main's checkout, so
`REPO_ROOT` there *is* main. Replace the pin with:

- **`daemonInstall(dep, { exec, log, start })`** (new, `deps/internal/daemon.ts`,
  replaces `pinnedDep` / `pinDep` / `holdRunningDep`):
  1. `ensureDep(dep)` at `REPO_ROOT` → the declared install.
  2. If the declared identity is recorded as **failed** (§3) and a `-good`
     install exists → use `-good` directly (a failed version is never retried
     on every boot).
  3. Hold it `<holder>-running` (as today: before the start, so the sweep
     never takes bytes a daemon runs), `await start(install)`.
  4. Success → hold it `<holder>-good`; clear a failed record for another
     identity.
  5. Failure, and a `-good` install that is another identity → record the
     declared identity as failed, hold `-good` as running, `await start(good)`
     once, return `{ kind: "rolled-back", from, to, error }` (caller files the
     report, §4). Retry fails too → throw both errors (gateway watchdog files
     service-down, as today).
  6. Failure with no other `-good` → rethrow (today's behaviour).
- **Reattach** (daemon already live) holds the running install `-good` — so
  machines upgrading to this code get a rollback target at once, from the
  install that is running fine.
- `Dep.pin` → `Dep.daemon: { holder, appliesAt, smoke }` (§2).
  `switchBlocked` is dropped: a major is caught by the smoke test before
  push (§2) and, as a last line, by the start's existing `assertSameMajor`
  → rollback.

Callers: `plugins/database/plugins/embedded/scripts/start.ts` (`freshStart`
→ `pg_ctl -w` + `ensureClusterState` as the `start` callback; reattach
marks good), `scripts/pinned-binaries.ts`;
`plugins/database/plugins/pgbouncer/scripts/start.ts` (`waitReady`),
`scripts/pinned-binary.ts`. Release builds (`PG_BIN_DIR` / `PGBOUNCER_BIN`)
are untouched.

Timing: two `pg_ctl -t 30` attempts fit the gateway's 5 min
`defaultStartCommandTimeout` (`gateway/supervisor.go:200`).

### 2. The upgrade agent proves the binary before pushing

The `Updater` contract already has `smoke(root, moves)` — commands run
before and after a move; a failure that is new after the move is a
regression, and the runner puts the move back
(`deps/plugins/updates/core/internal/updater.ts:186`). The npm updater
returns `[]` today (`npm/server/internal/npm-updater.ts:371`).

- A daemon dep declares `daemon.smoke: { argv, timeoutMs }`.
- The npm updater's `smoke` returns the smoke of every declared daemon dep
  whose source packages a move touches (generic: package-copy sources expose
  their package names; no dep is named in the updater).
- Smoke scripts (in the owning plugins' `scripts/`):
  - **Postgres:** `ensureDep` the checkout's install; refuse if its major
    differs from the live cluster's data dir (`PG_VERSION` file) — "major
    upgrade, no procedure exists"; `initdb` a temp data dir, start a
    postmaster on a temp socket dir, run a query, stop, delete.
  - **PgBouncer:** `ensureDep`; start on a temp config and socket dir (no
    backend needed), `SHOW VERSION` on its admin console, stop.
- **Major:** the smoke fails → the runner narrows it out as a regression and
  puts it back; the agent records an npm hold (`below: "<next major>"`, reason
  "major upgrade needs a data migration — no procedure yet", `reviewBy` ≤ 90
  days) and reports it in its outcome. The existing hold review brings it back
  at most every 90 days. No new mechanism.

So a push to main that moves a daemon package has already started that
binary once.

### 3. Recorded state

`state/deps-daemons/<id>.json`: `{ failed: { identity, version, at, error } | null }`
— written on a rollback, cleared when main declares another identity or a
start of a new identity succeeds. Replaces `state/deps-pins/` (pin-review's
lag/stay record), which is deleted with `pin-review.ts`.

### 4. Report

New report kind `daemon-binary-rollback` (`ReportKind`, as
`gateway-drift/server/internal/restart-failed-kind.ts`), filed from the start
script with `fileReportFromProcess` (`reports/outbox/file/core`, as
`debug/boot-events/machine/internal/boot-crash.ts`): dep, from/to versions,
the start error. Its task: the machine runs the previous version; fix, and
the next start after main declares a new identity retries.

### 5. Health row

`pin-drift` → renamed `daemon-binaries` (`./equin plugin move`). One row,
"Daemon binaries":

| State | Level | Text |
|---|---|---|
| runs what main declares | ok | Up to date with main |
| main declares another, not yet restarted | ok (note) | "postgres-binaries 18.6.0 at next restart" |
| rolled back | attention | "postgres-binaries 18.6.0 failed to start — running 18.1.0" |
| declaration unreadable | unknown | as today |

Detail pane: per dep, running vs declared, and the rollback's error.

### 6. Removed

- `./equin deps pin` and `./equin deps pin-stay` (`deps/cli`), `pinDep`,
  `pinnedDep`, `pinStatus`, `pin-review.ts` (lag clock, stays, `PIN_LAG_MAX_DAYS`).
- pin-drift's `decisions.ts` (`DecisionDeclare` source) and the `recordPinReviews`
  call in `reaction.ts`. The `DecisionDeclare` registry in `updates` stays
  (generic, now with no contributor).
- Old `machine-postgres` / `machine-pgbouncer` pin holds: deleted by the first
  start on the new code (the sweep then reclaims unused installs).

## Critical files

- `plugins/infra/plugins/deps/deps/internal/{pin.ts → daemon.ts, dep.ts, pin-review.ts (delete)}`, `deps/index.ts`, `cli/`
- `plugins/infra/plugins/deps/plugins/npm/server/internal/npm-updater.ts` (`smoke`)
- `plugins/database/plugins/embedded/{scripts/start.ts, scripts/pinned-binaries.ts, scripts/smoke.ts (new), plugins/binaries/deps/index.ts}`
- `plugins/database/plugins/pgbouncer/{scripts/start.ts, scripts/pinned-binary.ts, scripts/smoke.ts (new), plugins/binary/deps/index.ts}`
- `plugins/infra/plugins/deps/plugins/pin-drift/**` → `daemon-binaries`
- Docs: `infra/deps/CLAUDE.md` § Pinned installs (rewritten as "Host daemon
  installs"), `updates/CLAUDE.md` (decision source mention), `npm/CLAUDE.md`
  (smoke), `database/embedded/CLAUDE.md`, `pgbouncer/CLAUDE.md`.

## Verification

- Unit (`./equin test plugins/infra/plugins/deps`): `daemonInstall` on a temp
  store with a fake `start` — success marks good; failure with another good
  rolls back and records failed; a recorded-failed identity goes straight to
  good; failure with no good rethrows; double failure throws both; reattach
  marks good. npm `smoke` returns a daemon dep's smoke only when its package
  moves. Health verdict tests for the table.
- Smoke scripts run for real: `./equin run plugins/database/plugins/embedded/scripts/smoke.ts`
  (and PgBouncer's) against this checkout — temp cluster only, the shared
  cluster is never restarted.
- `./equin deps upgrade --dry-run`-style check that a Postgres move lists the
  smoke (if the runner has a plan-only mode; otherwise a unit test on the
  runner with a fake updater).
- `./equin build`; the row reads "Up to date with main".
