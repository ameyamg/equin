# Memory admission for heavy `./equin run` scripts (and test VMs)

2026-11-24 — task-1795551653, user decision D13 = A. Supersedes
task-1795039035-ecraub. Mental model this extends:
[[page:block-f0d24b10-d743-409d-bbc1-844ed27db026]] ("Build, check,…") and
`plugins/infra/plugins/host/plugins/host-admission/CLAUDE.md`.

## The problem

Builds, checks, tests and pushes take a share of the host `cpu` pool before
they start, and that share is charged for memory (the measured window). A plain
`./equin run <script>` is _recorded_ (an op marker, an op-log row) but never
_admitted_: it starts at once, whatever the host holds. A test VM (`tart`) is
not even recorded.

The user's constraint: admission must not make small, cheap scripts wait.

## What the records say

Sources: main's `health-owners` log (every 30 s, the largest processes by
name; 44,518 samples, 2026-11-06 → 11-24, 19 days), `duress-episodes`
(memory-pressure episodes), the op log (14 days). Scripts in
`$EQUIN_SCRATCH/{owners,scripts,duress,cover}.py` of conv-1795551653-ixbryp
(one-off; the numbers are below).

**How often, how much**

| | |
|---|---|
| `script` ops (op log, 14 days) | 3,442 (≈ 246 a day); p50 2.7 s, p90 69 s |
| script runs that peaked ≥ 3.6 GB (one quantum, `PER_UNIT_BYTES`) | 81 in 19 days, on 8 days — about 2 % of runs |
| … ≥ 7.2 GB | 24 runs, on 6 days; the largest 20.2 GB, 18.5 GB (50 min), 13.1 GB (73 min) |
| time with a script process ≥ 3.6 GB alive | 331 min in 19 days — 1.4 % of samples |
| distinct scripts behind the 81 runs | 19; 15 of them build a whole-repo TypeScript program (a type-check worker run by hand, an inventory, a rename) |
| the VM (`com.apple.Virtualization.VirtualMachine`, `tart`) | alive on 5 of 19 days, 5.8 % of samples, 6–16 GB (once 29 GB with two) |

**What it costs**

| memory-pressure episodes, 11-06 → 11-24 | episodes | seconds |
|---|---|---|
| all | 155 | 21,993 |
| with a script ≥ 3.6 GB alive | 59 (38 %) | 9,457 (43 %) |
| with a VM alive | 33 (21 %) | 5,874 (27 %) |
| with either | 69 (45 %) | 11,007 (50 %) |

A heavy unadmitted script is alive 1.4 % of the time and in 38 % of the
episodes (27× over-represented); the VM 5.8 % of the time and in 21 %
(3.7×). Correlation, with one caveat: some of these scripts were launched to
investigate the pressure itself. But 8 of the 10 longest script-linked
episodes have a 7–20 GB script that started before the episode.

**What admitted work waits today** (op log, 14 days, background lane): a check
waits p50 0 s, p90 45 s, p99 489 s, mean 23 s; a test p50 0 s, p90 27 s. That
is what a heavy script would wait once admitted.

## How it relates to the grant / scheduler model

The page's model, in one line: _an op takes a grant before it starts; the
grant is a share of one host-wide pool whose window follows measured memory;
a share is reserved what its kind of work was measured to peak at._

Where scripts stand in it today:

- They are **charged, not admitted**. The window formula already subtracts
  every op's measured tree, admitted or not (`opsBytes − Σ holders`), and the
  VM's bytes are in `otherBytes`. So admitted work _yields_ to a heavy script
  and to a VM — a build queues while the script runs — but the script itself
  never queues, reserves nothing while it grows (a TypeScript program takes
  minutes to reach 12 GB; ops admitted meanwhile were sized without it), and
  jumps every line.
- The page's own todo says it: _"Also include other app heavy tasks? So
  there's no blind spots"_ and the scheduler track's \[Ledger\] item:
  _"learned footprints; admission per heavy child"_.

The design **extends** the model; it bends nothing:

| model concept | builds / checks today | heavy script, this design |
|---|---|---|
| what a share is reserved | what holders of its work peaked at (holder-peak ledger, p95, corroborated) | what **this script** peaked at in its own recent runs (script-peak ledger) |
| who measures | main's sampler, the holder's process tree | the script process itself at exit (the kernel's lifetime peak footprint — exact, no 30 s gap) |
| share shape | elastic (narrows under load) | rigid in the background lane (`min: max`): one process cannot narrow, like the type-check backstop |
| "unknown yet" | `units × quantum` until 10 records | **not admitted** until one run has shown it heavy |
| tier | holder lifted to the foreground | same, once admitted |

The one real difference is the last-but-one row. A kind of work (build, check)
is heavy or light as a class, so a holder can be charged before it has a
record. A script is an arbitrary program: 98 % are light, and nothing says
which before they run. Charging the unknown a quantum would make every small
script queue — exactly what the user ruled out. So for scripts **"heavy" is a
measured fact about that script, never a declaration and never a default**:

> A script is heavy when the largest peak footprint of its last 5 recorded
> runs (14 days) is at least one quantum (`PER_UNIT_BYTES`, 3.6 GB). It then
> takes `ceil(peak / quantum)` units (capped at the background window) before
> it starts. Every other script starts at once, as today.

One quantum is the model's own unit: "one type-check-class worker". Below it,
a script is lighter than the lightest thing the pool counts as a unit.

**Why not the alternatives**

- _Admit every script_: 3,442 runs a fortnight would join the line for 81
  that matter. Ruled out by the user.
- _The script declares itself heavy_ (a flag, an export): the heavy ones are
  one-off investigation scripts written by an agent that does not know the
  weight either; a declaration is rung 5 (documentation) and the 11-06 and
  11-18 scripts would not have carried it.
- _Admit in the heavy primitive_ (the type-check worker takes a grant when
  run with none): covers 4 of the 19 scripts; the others build their program
  through `typescript` directly.
- _A size cap on unadmitted scripts_ (kill above a quantum): see the open
  decision below.

## What it covers, replayed on the 19 days

Replaying the rule on the recorded runs (a run is "covered" when one of the
script's 5 previous seen runs was ≥ 3.6 GB):

| | covered (admitted before start) | not covered (first heavy run of that script) |
|---|---|---|
| heavy runs | 56 of 81 (69 %) | 25 |
| minutes ≥ 3.6 GB | 164 of 331 (50 %) | 167 |
| script-linked pressure episodes | 34 of 59 — 4,378 s | 25 — 5,079 s |

Cost side: at most 65 runs in 19 days (3.4 a day, of ≈ 246) would have been
admitted although that run stayed under a quantum (the same script, lighter
arguments). Each waits like a background check: p50 0 s, p90 45 s. Every other
script pays one read of a ledger file (≈ 350 KB at this host's rate) and
never waits.

## What ships with this doc

1. **Script-peak ledger.** `./equin run` asks every plain script for its
   peak footprint at exit (`spawnPassthrough`'s `peakFootprint: "report"`, the
   mechanism check workers already use) and appends `{t, script, peakBytes}`
   to `logs/script-peaks/script-peaks.jsonl`. The script is named by its
   repo-relative path (the same file in every worktree is one script); a
   scratch script by its absolute path.
2. **Admission when heavy.** Before spawning, `run` reads that script's
   records; when heavy it takes a `cpu` share (`work: "script"`, rigid in the
   background lane), says so on stderr, and runs lifted to the foreground
   like every grant holder. Otherwise unchanged.
3. **Reservation follows the holder's own measured weight.** A script
   holder states its recorded peak on its holder marker (`weightBytes`), and
   the share is reserved that — not `units × quantum`, and not the by-work
   p95 of _other_ scripts (`shareReserve`). See "A holder's own weight" below.

Measured after the change (this host, 2026-11-24): the ledger read is 3.6 ms
and the peak report adds ≈ 21 ms to a script's start (38 ms against 17 ms for
an empty bun script, median of 12) — against ≈ 5 s of CLI wall time per run. A
4.3 GB scratch script ran unadmitted the first time and took 2 slots the
second.

Limits, stated:

- **A rigid share exists only in the background lane at normal priority.**
  On the main checkout (interactive) or a low-priority checkout (a sidequest
  task), a heavy script's share is elastic: it can be _admitted_ on fewer
  slots than its weight. It is still _reserved_ its whole weight from that
  moment (`weightBytes`), so everything after it is sized with it.

- **A first heavy run is not admitted** (the "not covered" column). It is
  still charged against the window as today. See the decision below.
- **A script killed by a signal reports no peak** (the report is written at
  exit), so a run that is always killed is never learned. The sampler's
  30 s reading could fill this; not built — no such case measured yet.
- **Only the script's own process is measured**, not its children. 15 of the
  19 heavy scripts are one process; a script that fans out into heavy
  children should spawn checks (admitted on their own).

## A holder's own weight (asked by the D14 audit, 2026-11-24)

The memory-admission chain task b3zkvv → 2gcdd5 → hcofne patched one heavy
holder at a time: a hand-declared 18 GB weight for the type-check backstop
with a ± 20 % drift check, an elastic grant that under-booked that rigid
holder, and the backstop unscheduled on hosts under ≈ 47 GB. Two questions.

**Should a holder's grant follow its measured peak rather than a
hand-declared weight? Yes — and it is two different numbers.**

- The **reservation** (bytes charged while it runs) already follows the
  record for every work with ≥ 10 holder-peak records. For the backstop that
  is the last 12 runs, 14.9–21.3 GB; the declared 18 GB is not read for it.
- The **units** it asks for (its slot count, which also decides whether it
  can ever run on a host) are still `ceil(18.0e9 / quantum) = 5`, by hand.
  That is the number the drift check guards.

What ships here is the mechanism that makes the hand-declared number
unnecessary: a holder may state its own measured weight
(`withHostGrant`'s `weightBytes`), and a heavy script derives both its units
and its reservation from its own recorded peaks — no constant, nothing to
drift. The backstop can move onto the same rule (units and weight from its
own holder-peak records, the constant kept only as the seed for a host with
no record yet), which deletes `TYPE_CHECK_BACKSTOP_PEAK_BYTES`'s drift check.
**Not folded in here**: it has no measured cost today (the declared 18.0 GB
is inside the tolerance of the measured 17.1 GB mean), it changes when a
nightly job is scheduled on small hosts (`cannotRunHere` reads the units),
and a host with no records needs a seed either way. Filed as a follow-up.

**Can a rigid holder be under-booked by construction? Before this change,
yes, three ways; one is left.**

| how | before | now |
|---|---|---|
| its share comes back short (elastic acquire: the interactive lane, low priority, or a caller that forgot `min`) and its work has < 10 records → reserved `granted units × quantum` | under-booked | a holder that states `weightBytes` is reserved it, whatever it was granted |
| it is heavier than the lane (units capped) | under-booked by the excess | a script is reserved the whole lane and no more, on purpose: an unbounded weight would let one outlier run (55 GB) close the window for everyone; beyond it the holder is charged what it measures |
| its work's p95 is below this holder (a mixed work) | under-booked until the next 30 s reading | same: reserved its own weight |
| **admitted** on a short share while the window has no room for its weight | possible | **still possible** where a rigid share does not exist (interactive lane, low priority) |

So booking is fixed for any holder that states its weight; admission of a
non-narrowing holder is only sound on a rigid share. Rigidity is still the
caller's choice (a holder that should be rigid can ask elastically, the
hcofne bug). Making that inexpressible means deriving "rigid" from the fact
"this holder states a weight above its granted units" inside
`withHostGrant`, and giving the interactive and low-priority lanes a rigid
acquire — a change to `host-semaphore`'s line discipline, not proportional
here: one holder (the backstop) is rigid today and it already asks rigidly.

## Open decision 1 — the first heavy run of a script

25 runs in 19 days (1.3 a day), 167 heavy minutes, present in 25 pressure
episodes (5,079 s, 23 % of all pressure seconds). Options:

- **A. Leave it** (what ships): the first run is charged but not admitted;
  the second is. No script is ever interrupted.
- **B. Pause on growth**: when an unadmitted script crosses one quantum,
  `run` takes a share for it; if none is free, the script is suspended
  (`SIGSTOP`) until one is, then resumed. Covers the 25, but a stopped
  process keeps its locks, sockets and database connections, and reading its
  size needs a timer (there is no kernel event for "crossed N bytes").
- **C. Stop on growth**: above one quantum unadmitted, the script is ended
  with a message, and its next run is admitted. Simple and loud, but throws
  away minutes of work once per heavy script (19 scripts in 19 days).

Recommendation: A now; revisit B only if first runs still show in pressure
episodes after two weeks of the ledger.

## Open decision 2 — test VMs

A VM is started by hand (`tart run`, 12 GB macOS or 8 GB Linux guests); no
equin code is in the path, so there is nothing to admit through today. Its
memory is already in `otherBytes`: admitted work yields to it. It was alive on
5 of 19 days and in 33 episodes (5,874 s). Admitting it needs a wrapper verb
(a rigid share of the guest's configured memory) plus a guard sending raw
`tart run` to it. Proportional only if VM work keeps happening: filed as a
follow-up with these numbers rather than built here.
