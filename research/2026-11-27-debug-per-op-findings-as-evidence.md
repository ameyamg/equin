# Per-op findings become evidence of end-to-end reports (D26 step 3)

Task: task-1795748928-jhdkxr. Decision: D26 (dec-1795742671-zgsl31), option A.
Steps 1 and 2 landed the two end-to-end alerts: `page-load` ("page not ready
after 5 s", 5be4f3c62d) and `live-again` ("tab not live again after 10 s",
8d200aa2ba), both client slow-op items filed by the latency ledger.

## Context

Per-op reports (slow-op, op-rate, boot-budget) fire with no link to whether a
person waited. Main, last 7 days: slow-op 237 fingerprints, op-rate 183,
boot-budget 22. Sampled occurrences (`reports.recent`, ≤ 10 kept per
fingerprint), matched to main's 517 ready instants (`boot.jsonl`):

| kind | sampled occ. | within ready −5 s … +30 s |
|---|---|---|
| op-rate, boot window | 522 | (the boot window itself — all restart) |
| op-rate, steady / hour / warm-up | 249 | 14 |
| slow-op update | 157 | 143 |
| slow-op wait | 137 | 73 |
| slow-op element | 134 | 67 |
| boot-budget | 129 | 54 (115 within +60 s) |
| slow-op db | 122 | 88 |
| slow-op push | 76 | 57 |
| slow-op bg | 70 | 25 |
| slow-op loader | 51 | 46 |
| slow-op http / sub | 32 | 21 |

Most per-op findings are one restart's shared cost, seen once per op.

## The rule

A per-op finding is judged by one question: **was an end-to-end measure
pending while it happened?**

- **Yes → evidence.** No standalone report. The finding is recorded as today
  (slow_ops rows, markers, op-rate history) and attached to the end-to-end
  report of that wait if one fires. If the wait ended inside its budget, no
  report: nobody waited past the budget.
- **No → standalone**, as today (background work: jobs, watchers, builds).
- **Cost reports stay standalone always**: op-time (count × cost, gate waits),
  op-rate steady / hour windows (an op called far more than usual = wasted
  work), live-state-noop, etc. They are about sustained cost, not latency.

"Pending" is known in two places:

1. **The tab** (client items: `element`, `update`, `confirm`, `main-thread`, …).
   The latency ledger opens a *user wait* for each page load (navigation start
   → ready) and each recovery (socket drop → live again), in a small registry
   in `debug/slow-ops/sink` core (`beginUserWait`). The slow-op queue stamps
   each item whose window overlaps a wait of its tab with `during: <waitId>`.
   The e2e item itself carries `measures: <waitId>` and its window start. A
   wait the ledger excludes (tab hidden) is cancelled and stamps nothing.
2. **The server** (server spans, waits, op-rate boot window, boot-budget).
   The server cannot see a tab's page load, but it knows its own restart: the
   **restart recovery window** = [ready (the gateway swaps and every tab's
   socket drops), the replay settled] when the replay had requests
   (`whenReplaySettled`: `replayed` / `ceiling`; `no-replay` = nobody waited).
   A finding whose wall window overlaps it is evidence. While the replay is
   still unsettled, the judgement waits for it (≤ herd 3 s + ceiling 30 s).

Steady-state server findings stay standalone (the server has no tab's page
load to compare against); they are still listed as evidence on any e2e report
whose window they overlap, with their report id.

## Evidence on the e2e report

`debug/slow-ops` server keeps an in-memory ring of every per-op finding
(held or filed, last 15 min, ≤ 2000): source (slow-op / op-rate /
boot-budget), what (its message), own ms, wall window, its wait (tab wait id,
or the restart), its report id when filed.

An e2e item (`page-load` / `live-again`) is filed through `recordReport` with
`occurredAt`, its payload carrying `findings` (count, top 20 by ms): client
items held under its `measures` id, plus every server finding overlapping its
window. It is kept "open" for 10 min (op-rate may judge the boot window up to ~8 min after the restart): a finding that arrives later (boot-budget
judges each minute, op-rate every 5) and matches restates the occurrence
(`restateReportOccurrence`, coalesced 2 s) — never a new occurrence, no bell.

The report's KindView and task description list the findings.

## Where

- `debug/slow-ops/sink/core`: `beginUserWait`, `userWaitDuring`; signal gains
  `userWait` (`{ id, startedAt }`) for e2e items.
- `debug/slow-ops/web`: queue stamps `during`; endpoint item schema gains
  `during`, `measures`, `measureStartedAt`.
- `debug/latency-ledger/web`: opens / ends / cancels the waits.
- `debug/slow-ops/server`: `findings.ts` (ring, restart window, judgement,
  e2e matching, restate); `record-slow-op.ts` routes each admitted item;
  barrel exports `judgeFinding` for op-rate / boot-budget.
- `debug/op-rate`, `debug/boot-budget`: boot-window op-rate trips and boot
  hooks go through `judgeFinding`; op-time and steady op-rate unchanged.

## Known limits

- The ring is per backend and in memory: a finding from the old backend is
  not attached to a live-again report filed to its successor (old-backend
  findings after the swap are its drain — background).
- The server's restart window ends when the replay is answered, a little
  before the tabs apply it; a server finding seconds later is standalone.
- A hidden tab's replay still counts in the server's restart window (the
  server cannot see visibility).

- Client items overlapping a user wait still open stay in the tab's queue
  until it ends (then stamped `during`) or is cancelled (then filed on their
  own): a page load that turns hidden never strands its slow elements.
- A held finding reaches a report only if one fires: a restart whose tabs were
  all live again inside 10 s (or all hidden) files nothing for it. That is
  the D26 trade: an `onReady` hook or a boot-window op-rate loop that does
  not hold up any tab's recovery is no longer reported on its own.
- Many tabs' `live-again` reports of one restart share one row (per route); a
  late restate lands in full only on the row's newest occurrence — an older
  occurrence's restate keeps only its message. The newest carries the same
  restart findings.
- A report the engine did not record (shed, collapsed into a storm) takes no
  later evidence.
- Background work by its own kind (a `bg` pass, a `job` run, an op one of
  them issued directly) is never held, whenever it ran.

## Verification

Unit tests: the judgement (restart window overlap, pending → deferred,
no-replay → standalone), the client registry and queue stamping, e2e
matching and the restate; latency-ledger tracker tests for begin / end /
cancel. Build; in this worktree, kill the backend with a tab open and a 1 s
`liveAgainMs`: the live-again report lists the restart's findings and no
standalone per-op report is filed for them. Replay of last week for the
before → after counts.

## Before → after (replay of main, 7 days to 2026-11-27)

Sources: every recorded slow-op item (`slow-op-markers.jsonl`), op-rate and
boot-budget occurrences (`reports.count`), main's 517 ready instants
(`boot.jsonl`), page loads from `latency-ledger.jsonl`. The restart window is
approximated as ready → ready + 30 s (the replay ceiling; the real settle is
usually seconds); a tab's wait as its logged page load or ready + 15 s.

| per-op kind | occurrences before | still filed after |
|---|---|---|
| slow-op (server spans, waits, client items; e2e excluded) | 3,344 | ~1,206 |
| op-rate (boot windows held; steady / hour kept) | 1,003 | 312 |
| boot-budget (onReady / onAllReady held; onReadyBlocking kept) | 438 | 70 |
| **total** | **~4,785 (~684/day)** | **~1,588 (~227/day)** |

Per slow-op kind (before → after): wait 965 → 198, element 791 → 439,
update 461 → 93, push 349 → 152, db 309 → 59, bg 216 → 216 (background,
never held), loader 170 → 14, http 31 → 16, sub 12 → 1, main-thread 33 → 13.

**Real incidents of the week (reports fixed or regressed) with every sampled
occurrence held** — they would show only as evidence, on a `live-again` /
`page-load` report, and only if one fired:

- boot-budget `onReady:conversations` (report-1795168260-4ec6bt);
- op-rate boot windows: `table_mirror_replicas` / `site_mirror_replicas`
  routes and update, `deploy_deployments_ext_box_link` insert,
  `deploy.site-health` push and loader (102 calls vs ≤ 1 usual), two task /
  attempt selects (8 reports);
- slow-op restart costs: `wait read-admit`, `loader prototypes.list`,
  `wait worker:plugin-tree.faceted-index`, `loader` and `push
  deliver:config-orphans.report`, `loader claude-code-status`, `loader
  config-v2.auto-merges`; client `element stats.tasks.history`.

All are restart costs — the class D26 meant to judge by the restart-recovery
number instead. The op-rate boot loops are the trade-off: wasted work found
only at boot, now visible only on a slow recovery's evidence.

The other 22 fixed / regressed reports keep standalone occurrences.

Test cases named by the supervisor:

- task-1795749528-tl8sx3 (each restart files 10–20 browser element / update
  reports): stops — those items fall inside their tab's recovery wait.
- task-1795713687-8n0007 / task-1795742129-h4rh98 (~15 updates at once with
  the same 1.2–3.9 s own time): the storms came ~66 s and ~71 s after ready,
  past the server's window and a typical recovery (p50 3 s), so they still
  file unless that tab's recovery was itself still pending (then they ride its
  `live-again` report).

Verified on this worktree's build: with `/agents` open and the budget at
1 s, killing the backend filed `live-again /agents` (the tab's recovery took
7.4 s); the report was then restated with 4 findings held in the restart
replay (two loaders, two db queries — none filed alone), and a db query that
recurred after the replay settled filed on its own.
