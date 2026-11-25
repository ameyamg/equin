# sleep-clock

How long was the machine asleep between two moments?

```ts
const meter = createSleepMeter();
// … later, from a periodic tick …
const r = meter.read();
if (r.supported && r.sleptMs > 0) {
  // this window spanned a sleep: its timings describe the nap, not the workload
}
```

**Why it exists.** A laptop on battery naps in cycles of a few seconds. To any
instrument built on timers, a 6 s nap and a 6 s frozen process look the same: on
2026-09-20 main and an unrelated worktree backend filed "event-loop stall" reports
with identical durations for the same naps. A "the tick came very late" heuristic
cannot tell them apart without also erasing real freezes.

The OS can. macOS keeps a clock that runs through sleep (`CLOCK_MONOTONIC_RAW`) and
one that pauses (`CLOCK_UPTIME_RAW`); both are raw, so the difference of their
deltas over a window is the time asleep in it, exactly. Read through `bun:ffi`,
lazily, like `packages/flock`.

**Absolute reading.** `readSleepClock()` answers where the machine's sleep clock
stands right now, for comparing stamps taken by different processes or long apart:

```ts
const r = readSleepClock();
// { supported: true, boot, asleepMs, wakeAtMs } | { supported: false }
```

- `asleepMs` — cumulative time asleep since boot (MONOTONIC_RAW − UPTIME_RAW), the
  same value for every process on the box. Two readings with the same `boot` differ
  by exactly the sleep between them; across a reboot they are not comparable.
- `boot` — `kern.bootsessionuuid`, read once per process.
- `wakeAtMs` — `kern.waketime` (epoch ms) of the most recent wake, `null` if 0 or
  unreadable. It places only the LAST sleep on the wall clock.
- `darkWake` — whether the machine is in a DARK wake right now (IOKit's
  `IOPMrootDomain` "System Capabilities" without the graphics bit: a maintenance
  / Power Nap wake, awake for no person), `null` if unreadable; `atMs` the wall
  instant of the reading. The history places dark stretches from these
  (`darkWakeDuring`), for judging what a person waited on (slow-ops) — never a
  watchdog: work runs in a dark wake, so its deadline keeps counting there.

`createSleepMeter()` is the relative form, built on `readSleepClock()`.
`clockStampNow()` is the reading as a stamp stores it (`sleep-clock/stamp`'s
`ClockStamp`): both clocks, read at once. There is deliberately no public
sleep-only stamp reader — a sleep reading taken apart from its wall instant
(after an `await`, a lock wait) drops any sleep in between from every span
judged from it. Pass a `ClockStamp` around, never a `Date` plus a sleep
reading. `processStartStamp()` is the stamp of this process's start, whenever
it is called; `stampBefore` the stamp of another earlier instant this process
timed on an awake clock.

**Off darwin** both `read()` and `readSleepClock()` return `{ supported: false }`.
That is "cannot tell", never "did not sleep" — a caller decides what to do with an unknown.

## Judging an age: awake time, through one of three tools

A Mac sleeps every night — and on battery or lid-shut, dark-wakes for a minute
every ~15. A sleeping machine runs nothing: not the process being watched, not
what it waits on, not the sampler that refreshes a reading. So **every
watchdog, lease, deadline, staleness report or "stuck for N minutes" judgment
on work this machine runs counts AWAKE time**. On the wall clock every wake
looks like a hang as long as the nap, and each one costs an investigation
(2026-11-20: a fleet-memory reading "17 min stale", a boot "hung 16 min" across
a 934 s maintenance sleep, a slot "held 7384 s" for 7 min of work).

Pick by what you have:

| You have | Use |
|---|---|
| An in-process timer: "fire after N of work" | `armAwakeDeadline(ms, fn)` / `withDeadline` — `packages/deadline`. Never a bare `setTimeout` as a watchdog: timers count sleep. |
| A request's timeout (`fetch`'s `signal`) | `awakeTimeoutSignal(ms)` — `packages/deadline`. Never `AbortSignal.timeout(ms)`: it is a timer too. |
| A tool call that runs an op (`./equin build` …) | Nothing to do: the op runs off the call (`cli/call-handoff`), so the harness's wall-clock time limit cannot kill it. |
| An age measured in one process (start and now both read here) | `performance.now()` differences (`awakeClock`, `packages/deadline`): it pauses through sleep. |
| An instant stored and judged later, maybe by another process (a file, a log line, a DB row) | Stamp it with `clockStampNow()` (here), store the `ClockStamp`'s `sleep` beside the wall instant, judge with `awakeBetween(from, to)` — `sleep-clock/stamp` (pure, web-safe). Exact across processes. |
| A process's age from its own start, judged later or by another process | `processStartStamp()` (here). Never `performance.timeOrigin` beside a `sleep` read later: the sleep in between would count as awake. |
| Another process's age, read from outside it (a reaper, a sweep over `ps`) | `readProcessAwakeAge(pid)` (here): its kernel start record against the awake clock — exact on macOS, `unsupported` elsewhere (fall back to `ps etime`). Never `ps etime` alone: it counts every sleep since the process started. |
| Only a wall instant you cannot stamp (a DB `created_at`, a change's `changedAt`, another tool's timestamp) | `awakeMsSince(wallMs)` / `sleptDuring(start, end)` — `sleep-clock/history` (the sleeps this process saw, plus the one before it started; portable, so `core/` and the change feed use it too — `infra/host/machine-sleep`'s server half is the same history with the native clock guaranteed installed); `stampOfWallInstant(wallMs, now)` to store it as a `ClockStamp` beside real ones. |
| A temp file a sweeper may reap | Not an age at all: tag it with the writer's pid and reap it when that writer is gone — `packages/process-alive`'s `isOrphanedTemp`. |

Where the sleep cannot be told (off macOS, a reboot in between, an
unstamped record) each falls back to the wall clock — never in the judged
thing's favour.

**Not awake time**: what really ages across sleep — retention and TTL sweeps,
cache expiry, an external deadline (an OAuth state, a token, a remote
service's timeout), a lease whose point is that its holder may be dead (it
fails open). Those stay on the wall clock and say so in code:
`wallNow(reason)` (`packages/deadline`), a `Date.now()` with a typed
`WallClockReason`. A bare `Date.now()` used as an age or a deadline check is
reported by `deadline/no-unstated-wall-age`, so a deliberate wall-clock choice
can always be told from a forgotten one.

<!-- AUTOGENERATED:BEGIN — do not edit; regenerated by `./equin build` -->

## Plugin reference

- Description: How long the machine slept between two reads: the difference between the OS clock that keeps running through sleep and the one that pauses. Exact, read through bun:ffi on macOS; says so where it cannot tell.
- Core:
  - Uses:
    - `packages/proc-rusage.ProcRusage`
    - `packages/proc-rusage.readProcRusage`
    - `packages/sleep-clock/stamp.clockStamp`
    - `packages/sleep-clock/stamp.ClockStamp`
    - `packages/sleep-clock/stamp.SleepStamp`
    - `packages/sleep-clock/stamp.stampBefore`
  - Exports (types):
    - `AwakeClockReading`
    - `ProcessAwakeAge`
    - `SleepMeter`
    - `SleepReading`
  - Exports (values):
    - `clockStampNow`
    - `createSleepMeter`
    - `judgeProcessAwakeAge`
    - `processStartStamp`
    - `readAwakeClock`
    - `readProcessAwakeAge`
    - `readSleepClock`
- Cross-plugin:
  - Imported by:
    - `auth`
    - `config_v2`
    - `conversations`
    - `conversations/runtime-sdk`
    - `conversations/workspace/worktree`
    - `debug/boot-events`
    - `debug/boot-watchdog`
    - `debug/health-monitor`
    - `debug/profiling/op-log`
    - `debug/sentinel/machine-usage`
    - `framework/cli/op-runtime`
    - `framework/cli/push`
    - `framework/cli/test`
    - `framework/tooling/checks`
    - `infra/file-watcher`
    - `infra/git/main-slots`
    - `infra/git/main-slots/boot-lease`
    - `infra/host/host-admission`
    - `infra/host/machine-sleep`
    - `integrations/github-events`
- Exemptions:
  - Exempts itself from: `boundaries/no-platform-api` — `core/internal/sleep-clock.ts` (debt)
- Sub-plugins:
  - **`history`** — This process's sleep history, on every host: the sleeps it saw (plus the one before its first reading), fed by the sleep clock its host installs (installSleepClock — the desktop's host probes and…
  - **`stamp`** [1 sub-plugin] — The one way to judge an age on awake time: ClockStamp (a wall instant plus the machine's sleep clock at it — boot and cumulative time asleep), and awakeBetween(from, to) — the wall span between two…

<!-- AUTOGENERATED:END -->
