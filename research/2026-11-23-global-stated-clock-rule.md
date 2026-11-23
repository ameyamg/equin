# Every age or deadline states its clock

Task: task (Harness supervisor, conv-1794593627-bkjmc7) — "Sleep/wake timing bugs
are fixed one call site at a time: nothing makes an age or deadline say which
clock it runs on".

## Context

A Mac sleeps; `Date.now()` and `setTimeout` keep counting through it. Every
watchdog, lease, staleness check or "stuck for N" judgement written on the wall
clock fires on wake. ~22 commits since 2026-11-13 each moved one more call site
onto the awake primitives (`armAwakeDeadline` / `withDeadline` / `awakeClock` in
`packages/deadline`, `clockStampNow` / `awakeBetween` in `packages/sleep-clock`).
The rule "judge this machine's work on awake time" lives only in
`packages/sleep-clock/CLAUDE.md` (rung 5). `deadline/no-wall-clock-deadline`
(def165da5a) closes one shape at rung 3: a `setTimeout` whose callback gives up
(reject / abort / kill / exit). The other shape, an age or a deadline computed by
arithmetic on `Date.now()`, has no rule at all.

A blanket ban is wrong: retention, TTL / cache expiry, external deadlines, fail-open
leases and time as the user lives it (analytics idle windows, "2 h ago") are
correctly on the wall clock. The gap is that the choice is never written down, so a
deliberate wall-clock age looks the same as a forgotten one.

## Design

### 1. A named wall-clock read (the spelling of a deliberate choice)

`packages/deadline/core` gets `wallNow(why: WallClockReason): number`, which returns
`Date.now()`. `WallClockReason` is a closed union, each member with a doc comment
saying when it applies:

- `"retention"` — a sweep / prune / retention cutoff: data ages whether or not the machine ran.
- `"expiry"` — a cache entry or record TTL whose staleness is about the world, not about work.
- `"external"` — a deadline someone else keeps (OAuth state/token expiry, a remote peer's timeout, a third-party API date).
- `"fail-open-lease"` — a lease whose point is that its holder may be dead.
- `"human-time"` — time as a person lives it: idle/away windows, "x ago", calendars, schedules.
- `"instant"` — a wall instant compared with other wall instants for ordering or
  bucketing, not judged as an age of work.

The reason is a parameter, not a comment: tsc rejects a misspelled or missing one
(rung 2), it is greppable, and it carries no disable noise. It sits beside
`awakeClock` in `packages/deadline/core`, the one place both clocks are read.

### 2. Lint `deadline/no-unstated-wall-age` (rung 3)

Reports a bare `Date.now()` (or `new Date().getTime()`) that is used in an age or
deadline shape:

- an operand of `-`, `<`, `<=`, `>`, `>=`, directly;
- or through a `const` (or a parameter default) it initialises, when any reference
  of that binding is such an operand (`const now = Date.now(); … now - row.at`).

Not reported: `Date.now() + ttl` alone (computing an expiry, judged where it is
compared), a stored or logged instant, `performance.now()` arithmetic (awake already).

The message points at both ways out: awake time (`awakeClock()` differences,
`clockStampNow()` + `awakeBetween`, `armAwakeDeadline`), or `wallNow(<reason>)`.

Scope: same as its sibling, machine-run code. Out: `web/`, `e2e/`, `exhibits/`,
tests, generated, research. Browser code is out because a browser tab cannot read
the sleep clock and a frozen tab has its own semantics; a browser judging a
machine's reading should get an awake age from the server, a separate follow-up.

### 3. Existing sites

Measure with the rule. Each flagged site is classified:

- wrong clock (age/watchdog of this machine's work) → convert to awake primitives;
- deliberate wall → `Date.now()` → `wallNow("<reason>")`.

Mechanical conversion of the clearly-deliberate sites can use Sonnet subagents with
the classification table; the ambiguous ones are judged by hand and listed in the
report.

### 4. Docs

`packages/sleep-clock/CLAUDE.md` § "Not awake time" points at `wallNow` and the
rule; `packages/deadline/CLAUDE.md` documents the rule beside its sibling.

## Verification

- RuleTester suite for the rule (direct, via const, via param default, `+` not
  reported, `wallNow` not reported, browser paths out of scope).
- `./equin check type-check` (the lint runs inside it) passes on the whole repo.
- Time cost: compare `type-check` duration before/after.
- Opus review agent over the diff before `./equin push`.
