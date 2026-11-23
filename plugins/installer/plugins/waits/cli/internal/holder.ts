import {
  armAwakeDeadline,
  awakeClock,
  wallNow,
} from "@plugins/packages/plugins/deadline/core";
import { readOpRecords } from "@plugins/debug/plugins/profiling/plugins/op-log/cli";
import {
  readBuildProgress,
  type BuildRunProgress,
} from "@plugins/framework/plugins/cli/plugins/build-progress/cli";
import {
  readCheckProgress,
  type CheckRunProgress,
} from "@plugins/framework/plugins/tooling/plugins/checks/core";
import {
  awakeWithin,
  type OpRecord,
} from "@plugins/debug/plugins/profiling/plugins/op-log/core";
import type { GrantHooks } from "@plugins/infra/plugins/host/plugins/host-admission/core";
import type { WaitHolder, WaitOn } from "@plugins/installer/core";
import {
  installEventsOn,
  reportInstallResolved,
  reportInstallStall,
  reportInstallWait,
} from "@plugins/installer/cli";

/**
 * A `./equin` command run as an install step that waits on other work tells
 * the install WHO it waits on: an install `wait` event carrying the holder
 * (installer/core `WaitHolder`), read from the op log — the one record of
 * every op on the machine. "No progress for 10 minutes" with nobody named is
 * the failure this module removes (2026-11-17 Tart VM installs: `./equin
 * start`'s dependency build sat 22 minutes behind main's first build on the
 * 1-slot floor, and the install said nothing about it).
 *
 * Outside an install every function here is a no-op.
 */

/** A wait reported to the install, closed with `end()` (idempotent). */
export interface OpenInstallWait {
  end(): void;
}

const NO_WAIT: OpenInstallWait = { end() {} };

/**
 * Report a wait on the machine's build slot (the host CPU grant): its holder
 * named, and the stall rule armed on it.
 */
export function reportHostGrantWait(): OpenInstallWait {
  if (!installEventsOn()) return NO_WAIT;
  return openWait("host-grant", grantHolder());
}

/**
 * Report a wait on a lock another run of the same work holds (`lock`): its
 * holder is the oldest running op of `kind`, when the op log names one.
 */
export function reportLockWait(kind: string): OpenInstallWait {
  if (!installEventsOn()) return NO_WAIT;
  return openWait(
    "lock",
    oldestWorking((r) => r.kind === kind),
  );
}

/**
 * The host-grant hooks of a command run as an install step: the queue for the
 * build slot reported as a wait naming its holder. `undefined` outside an
 * install, so a caller passes it through unconditionally.
 */
export function installGrantHooks(): GrantHooks | undefined {
  if (!installEventsOn()) return undefined;
  let open: OpenInstallWait | null = null;
  return {
    onWaitStart() {
      open?.end();
      open = reportHostGrantWait();
    },
    onAcquired() {
      open?.end();
      open = null;
    },
  };
}

function openWait(on: WaitOn, holder: WaitHolder | null): OpenInstallWait {
  reportInstallWait("start", on, ...(holder === null ? [] : [holder]));
  const watch = holder === null ? null : watchHolder(holder.op);
  let ended = false;
  return {
    end() {
      if (ended) return;
      ended = true;
      watch?.stop();
      reportInstallWait("end", on);
    },
  };
}

/**
 * Who holds the machine's build slot: the longest-running op that is working
 * (admitted, not parked in a wait of its own). Null when the op log names
 * none — the slot is then held by work the op log does not record.
 */
function grantHolder(): WaitHolder | null {
  return oldestWorking(() => true);
}

function oldestWorking(match: (r: OpRecord) => boolean): WaitHolder | null {
  const working = readOpRecords()
    .filter(
      (r) =>
        r.outcome === "running" &&
        r.openWait === null &&
        // Never the waiter itself: a build reports its lock wait before its
        // own op record shows the wait open.
        r.pid !== process.pid &&
        match(r),
    )
    .sort((a, b) => a.grantedAt.localeCompare(b.grantedAt));
  const oldest = working[0];
  if (oldest === undefined) return null;
  return { op: oldest.opId, kind: oldest.kind, startedAt: oldest.grantedAt };
}

// ── The stall rule: waiting on a holder that stopped making progress ─────────
//
// Both halves are judged on AWAKE time (`packages/sleep-clock`'s rule): a
// sleeping Mac runs neither the holder nor the install, so a night's sleep
// must not read as a holder quiet for hours on wake. The install's own wait is
// timed in this process on the awake clock; the holder's quiet span is the
// op log's wall span minus the sleeps its record holds (`awakeWithin`).

/** How long (awake) the install waits on a holder before it looks at it. */
export const STALL_WAIT_MS = 2 * 60_000;
/** How long (awake) the holder must have shown no progress to count as stuck. */
export const HOLDER_QUIET_MS = 10 * 60_000;

/** A build run as its progress log reconstructs it — what the rule reads. */
export type BuildRunMoves = Pick<BuildRunProgress, "pid" | "lastAdvanceAt">;
/** A check run as its progress log reconstructs it — what the rule reads. */
export type CheckRunMoves = Pick<
  CheckRunProgress,
  "runId" | "pid" | "startedAt"
> & { completed: ReadonlyArray<{ at: string }> };

/**
 * When the holder last made progress (epoch ms): when it got the slot, or
 * later, the newest move its own records show —
 *
 * - a wait of its own ending (a build's post-grant host-grant or duress gate):
 *   it went back to work then, not at its last move before the wait;
 * - its build run (build-progress, written by the same process): a span
 *   entering or leaving (`lastAdvanceAt`; the 30 s heartbeat does not count —
 *   it proves the process exists, not that it gets anywhere);
 * - its check runs (check-progress): a check settling, in the op's own process
 *   (`./equin check`), or in the check-pass child a build runs with its op id
 *   as `--run-id` — so a long check pass inside a build is progress too.
 *
 * Never the op record's steps: an in-flight record carries none (they land on
 * the terminal), which is how "stopped making progress" once meant "has held
 * the slot for 10 minutes" and a healthy cold build was offered to be killed.
 *
 * Runs are matched by pid (or the run id), never by checkout: a main build in
 * a slot names its check run after the slot, its op after main. No start-time
 * filter either — the build opens its run just before its op record, and a
 * dead process that once had the same pid only moved before this op was
 * granted, which the max already discounts.
 */
export function holderLastProgress(
  record: OpRecord,
  builds: readonly BuildRunMoves[],
  checks: readonly CheckRunMoves[],
): number {
  const requested = Date.parse(record.requestedAt);
  const moves = [
    Date.parse(record.grantedAt),
    ...record.waits.flatMap((w) =>
      w.atMs === undefined || w.wallMs === undefined
        ? []
        : [requested + w.atMs + w.wallMs],
    ),
    ...builds
      .filter((b) => b.pid === record.pid)
      .map((b) => Date.parse(b.lastAdvanceAt)),
    ...checks
      .filter((c) => c.pid === record.pid || c.runId === record.opId)
      .flatMap((c) => [c.startedAt, ...c.completed.map((x) => x.at)])
      .map((at) => Date.parse(at)),
  ];
  return Math.max(...moves.filter((ms) => !Number.isNaN(ms)));
}

/**
 * The stall rule's verdict for a wait that has lasted `waitedMs` of awake
 * time, with `record` read at the wall instant `now` (the axis its sleeps sit
 * on) and `lastProgress` its `holderLastProgress`: stuck (symptom: waited past STALL_WAIT_MS; fact: the holder is still
 * running and showed no progress for HOLDER_QUIET_MS while the machine was
 * awake), or how much more awake time until it could become so — a deadline,
 * re-armed only when the holder moved, never a fixed-interval look.
 */
export function judgeHolder(
  record: OpRecord,
  lastProgress: number,
  waitedMs: number,
  now: number,
):
  | { stuck: true; quietSince: number }
  | { stuck: false; recheckInMs: number | null } {
  if (record.outcome !== "running") return { stuck: false, recheckInMs: null };
  // Parked in a wait of its own (a build's post-grant host-grant or duress
  // gate): queued, not hung — and its turn is not what the install waits on.
  // Looked at again a full quiet span later.
  if (record.openWait !== null)
    return { stuck: false, recheckInMs: HOLDER_QUIET_MS };
  const quietSince = lastProgress;
  const quietMs = awakeWithin(record, quietSince, now);
  const left = Math.max(STALL_WAIT_MS - waitedMs, HOLDER_QUIET_MS - quietMs);
  if (left <= 0) return { stuck: true, quietSince };
  return { stuck: false, recheckInMs: left };
}

interface StallWatch {
  stop(): void;
}

/** Watch the holder while the step waits on it; report a stall once. */
function watchHolder(opId: string): StallWatch {
  const waitStart = awakeClock();
  let cancel: (() => void) | null = null;
  let reported = false;
  const check = (): void => {
    cancel = null;
    const record = readOpRecords().find((r) => r.opId === opId);
    // Gone from the live log: it ended (or rotated away) — nothing to watch.
    if (record === undefined) return;
    const verdict = judgeHolder(
      record,
      holderLastProgress(record, readBuildProgress(), readCheckProgress()),
      awakeClock() - waitStart,
      // The wall axis the record's sleeps were placed on; judgeHolder takes
      // them out, so this is an instant, not an age.
      Date.now(),
    );
    if (verdict.stuck) {
      reported = true;
      reportInstallStall(stallWords(record, verdict.quietSince));
      return;
    }
    if (!verdict.stuck && verdict.recheckInMs !== null)
      arm(verdict.recheckInMs);
  };
  const arm = (ms: number): void => {
    // A watch on someone else's work: never what keeps this process alive.
    cancel = armAwakeDeadline(ms, check, { unref: true });
  };
  arm(STALL_WAIT_MS);
  return {
    stop() {
      cancel?.();
      if (reported) reportInstallResolved();
    },
  };
}

/** "3 hours ago", "12 minutes ago". */
function ago(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 90) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const h = Math.round(min / 60);
  return `${h} hour${h === 1 ? "" : "s"} ago`;
}

/** The stall's words (the installer message rules), short enough for one event. */
export function stallWords(
  record: OpRecord,
  quietSince: number,
  now: number = wallNow("human-time"),
): { title: string; text: string; evidence: string[] } {
  const started = ago(now - Date.parse(record.grantedAt));
  return {
    title: "The install is waiting for an older task",
    text: `equin builds one thing at a time. A ${record.kind} started ${started} holds the turn but stopped making progress ${ago(now - quietSince)}. Stopping it lets the install go on: Fix with Claude can, asking first.`,
    evidence: [
      `build slot held by ${record.opId} (${record.kind}, pid ${record.pid ?? "?"})`,
      `last progress ${new Date(quietSince).toISOString()}`,
    ],
  };
}
