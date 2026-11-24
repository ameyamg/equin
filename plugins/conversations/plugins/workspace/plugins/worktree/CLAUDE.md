# workspace/worktree

The `worktree` workspace (`<repo>/.claude/worktrees/<attemptId>`): DB fork on
commit, the checkout in the spawn job's `prepare`, `forkConfigDir` after commit,
an empty launch fragment, resumable while the checkout exists. Its reaper is
`debug/worktree-cleanup`.

## The checkout runs in a supervised child

A backend restart (main's auto-build, a `./equin build`) signals the whole
process group, so a checkout made inside the spawn job died half-way with every
deploy. So `prepare` never makes it:

- **`worktree.prepare`** (`prepare-job.ts`) — a `defineSupervisedJob` with a
  `run` body, built-in ledger, `lock: attemptId`: the child runs `setupWorktree`
  (spare claim or cold add, the convergence of a cut-off one, the frozen
  install). `onEnded` on exit 0 enqueues the spare refill. A failed run
  dead-letters (built-in-ledger policy). Transcript: the `worktree-prepare` log
  channel. **Bounded host-wide**: `admission: "worktree-prepare"` (a host pool of
  4) — a child waits for a slot before it boots, so a launch storm queues its
  checkouts as idle processes instead of booting them all against the shared
  pgbouncer (2026-10-28: ten launches booted twenty children, 318
  `max_client_conn` refusals, three launches lost).
- **`prepare`** (`prepare-wait.ts`, `prepareWorktree`) — a durable
  observe-before-wait loop in the spawn job: a run open → wait on `runEnded`
  (30 s bound; on `checkoutProgress` until the files are there, below); a run THIS spawn requested exited 0 and the checkout reads
  `complete` (`checkoutState`, read-only) → done; otherwise request a run
  (`ctx.step("prepare:request:<n>")`) and wait for it. The checkout on disk is
  the authority, the event only a wake-up.
- **The agent starts in the files, not in the installed checkout.** Once
  `checkoutState` reads `complete` (a claimed spare switched, a cold add's
  tree written — the child discards only an `unfinished` checkout, so a
  complete one stays), the loop calls `filesReady` (the spawn starts the agent
  process, with no prompt) and goes on waiting for the run's end. Claude
  Code's own startup (~4 s, the same in an empty dir) then overlaps the
  child's install, fsmonitor and index refresh instead of following them
  (`research/2026-11-17-global-launch-and-build-latency-benchmark.md`, fix 6).
  Until the files are there, each wait is on **`worktree.checkoutProgress`**
  (`tables-checkout-progress.ts`, filtered by attempt): the child emits it
  from `setupWorktree`'s `onWritten` (files written and locked, before the
  install), and the job's `onEnded` on every run end — so a run that fails
  before writing them wakes the spawn too. After, on `runEnded`. Nothing
  reaches the agent before the run ended: the conversation stays `starting`
  while its spawn is in flight, so every turn is held (conversations' CLAUDE.md,
  "Status reconciliation"), and a launch that fails for good stops the agent
  it started (the spawn's `onDead`).
- **Nothing is installed in the spawn — a resume included.** A resume's
  existing checkout is re-locked and installed (non-frozen) by a prepare run
  too: `setupWorktree`'s `existing` path. It used to be adopted in process
  (re-lock + `./equin install` as a child of the backend), and every new launch
  re-ran that install after its child had just done it; a restart TERMs the
  backend's process group, so a deploy overlapping it killed the install and
  the spawn recorded a launch failure the next attempt then fixed (2026-11-04
  21:09Z, "equin install was killed by SIGTERM"). The cost: a resume pays one
  child boot (~6 s on an idle host, plus any wait for a `worktree-prepare`
  slot). Up to 3 requests, then a `NonRetryableError` carrying the last run's
  recorded error, which the spawn records (`conversation-spawn-failed`).
  A run that exited EX_TEMPFAIL (75: its database connection was refused
  because the database was full) is back-pressure, not a failure: a durable
  pause (15 s doubling, capped at 2 min) and a re-request
  (`prepare:retry:<n>`) from its own budget of 8 (~12 min), never spending one
  of the 3 — a storm must not use up the launch, whose auto-start marker was
  already claimed when it committed.
- While suspended, the spawn holds no queue row; `inFlight` counts a keyed run
  parked on a pending wait — in one read with the queue rows, against a resume
  that resolves the wait and inserts the row in one transaction (`infra/jobs`)
  — so the status sweep leaves the row `starting`.

## fsmonitor: one pass at a time, and a close costs one checkout

`server/internal/fsmonitor-job.ts`. The pass asks every retained checkout, so
its cost is `checkouts × passes`; both multipliers are held down there:

- **`serial`** — `singleton` collapses pending rows only. A pass counts awake
  time and the cron counts wall time, so on a sleeping laptop passes piled up
  beside each other.
- **A close enqueues `worktree.fsmonitor-release` for its attempt**, never a
  pass. Anything else that concerns one checkout should do the same.
- **A checkout's first reader enqueues `worktree.fsmonitor-on-read`** for its
  attempt (`followCheckoutReaders`, from `onReady`: each checkout watch that
  opens in main's backend). Every decision — pass, release, on-read — goes
  through one rule, `inUse`: retained, or watched now (on-read returns at
  once for a retained one: the pass keeps it). A finished checkout
  shown in a tab keeps its daemon until its readers leave and a pass finds it
  unused.

Design: [`research/2026-10-28-global-supervised-worktree-checkout.md`](../../../../../../research/2026-10-28-global-supervised-worktree-checkout.md).

<!-- AUTOGENERATED:BEGIN — do not edit; regenerated by `./equin build` -->

## Plugin reference

- Description: The worktree workspace: a conversation runs in its attempt's git checkout of this repo (`.claude/worktrees/<id>`), with a forked DB and config dir — checked out by the supervised worktree.prepare job (a detached child a restart does not kill) that the spawn job requests and waits on, resumable while the checkout exists. Keeps git's fsmonitor daemon running for main's own checkout and for exactly the checkouts in use — whose attempt is still retained, or that someone reads now (a checkout watch open in main's backend: a tab showing a closed conversation's edited files, a file explorer over it) — main only: worktree.fsmonitor-reconcile at start and every 10 minutes, one pass at a time; worktree.fsmonitor-on-read for a checkout whose first reader came; worktree.fsmonitor-release for the one checkout whose conversation closed.
- Server:
  - Contributes: `trigger` "worktree.fsmonitor-on-conversation-ended"
  - Uses: 41 symbols — full list in [REFERENCE.md](./REFERENCE.md)
    - `infra/worktree` ×12
    - `infra/jobs/supervised-job` ×6
    - `infra/jobs` ×4
    - `infra/git/fsmonitor` ×3
    - `tasks/tasks-core` ×3
    - `conversations/launch-timeline` ×2
    - `infra/events` ×2
    - `infra/git/checkout-watch` ×2
    - `config_v2.getConfig`
    - `conversations/workspace.Workspace`
    - `database/admin.databaseExists`
    - `database/fork.databaseForkJob`
    - `infra/warmup.defineWarmup`
    - `infra/worktree/spare-pool.spareRefillJob`
    - `primitives/log-channels.defineLogSink`
  - DB schema: `plugins/conversations/plugins/workspace/plugins/worktree/server/internal/tables-checkout-progress.ts`
  - Register:
    - `defineTriggerEvent('worktree.checkoutProgress')`
    - `defineSupervisedJob('worktree.prepare')`
    - `defineJob('worktree.fsmonitor-reconcile')`
    - `defineJob('worktree.fsmonitor-release')`
    - `defineJob('worktree.fsmonitor-on-read')`
    - `defineJob('worktree.fsmonitor-on-conversation-ended')`
    - `defineWarmup('worktree.fsmonitor-reconcile')`
- Exemptions:
  - Exempts itself from:
    - `boundaries/no-platform-api` — `server/internal/worktree-workspace.ts` (debt)
    - `ids:pk-declared` — `server/internal/tables-checkout-progress.ts` (debt)
- Test helpers:
  - Server: `@plugins/conversations/plugins/workspace/plugins/worktree/server/testing`
    - `worktreeWorkspace`

<!-- AUTOGENERATED:END -->
