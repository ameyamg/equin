import {
  armAwakeDeadline,
  awakeClock,
  wallNow,
} from "@plugins/packages/plugins/deadline/core";
import { readOpRecords } from "@plugins/debug/plugins/profiling/plugins/op-log/cli";
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

/**
 * When the holder last made progress, as the op log saw it: its newest step's
 * end (steps are placed by ms after the request), else when it got the slot.
 */
function holderLastProgress(record: OpRecord): number {
  const base = Date.parse(record.requestedAt);
  return Math.max(
    Date.parse(record.grantedAt),
    ...record.steps.map((s) => base + s.startMs + s.durationMs),
  );
}

/**
 * The stall rule's verdict for a wait that has lasted `waitedMs` of awake
 * time, with `record` read at the wall instant `now` (the axis its sleeps sit
 * on): stuck (symptom: waited past STALL_WAIT_MS; fact: the holder is still
 * running and showed no progress for HOLDER_QUIET_MS while the machine was
 * awake), or how much more awake time until it could become so — a deadline,
 * re-armed only when the holder moved, never a fixed-interval look.
 */
export function judgeHolder(
  record: OpRecord | undefined,
  waitedMs: number,
  now: number,
):
  | { stuck: true; quietSince: number }
  | { stuck: false; recheckInMs: number | null } {
  if (record === undefined || record.outcome !== "running")
    return { stuck: false, recheckInMs: null };
  const quietSince = holderLastProgress(record);
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
    const verdict = judgeHolder(
      record,
      awakeClock() - waitStart,
      // The wall axis the record's sleeps were placed on; judgeHolder takes
      // them out, so this is an instant, not an age.
      Date.now(),
    );
    if (verdict.stuck && record !== undefined) {
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
