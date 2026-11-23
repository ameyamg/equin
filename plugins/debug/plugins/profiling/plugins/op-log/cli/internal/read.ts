import {
  foldOpLines,
  parseOpLines,
  toOpRecords,
  waitersAhead,
  type LineOp,
  type OpFoldState,
  type OpLine,
  type OpenWait,
  type OpRecord,
} from "@plugins/debug/plugins/profiling/plugins/op-log/core";
import {
  opLogSink,
  readSleepNow,
} from "@plugins/debug/plugins/profiling/plugins/op-log/server";

/**
 * Read the live op log through its own sink's bounded reader.
 *
 * BOUND: the reader's 8 MB default byte budget, and `includeRotated` deliberately
 * NOT set — this is a recent-ops view (the Gantt / stats window), so stitching
 * `op-log.jsonl.1`/`.2` back in would put the memory straight back. With the one
 * sink left, that 8 MB budget is the whole per-request bound. The v2 terminal is
 * self-contained, so an op whose head was clipped still folds to a full record.
 *
 * `missing` is folded to `[]` HERE, as one visible line rather than absorbed by
 * the reader: on a fresh host nothing has ever run, which is a legitimate empty
 * history and not a failure.
 */
function readOpLines(): OpLine[] {
  const result = opLogSink.readJsonlTailSync<unknown>();
  if (result.kind === "missing") return []; // no op has ever run on this host
  const { lines, skipped } = parseOpLines(result.records);
  reportSkipped(skipped);
  return lines;
}

/**
 * Skip keys already reported by this process: one stderr line per kind of skip
 * (a newer writer's event kind), not one per read — a waiting op reads the log
 * on every wait. Bounded by the distinct skip kinds, not by the reads.
 */
const reportedSkips = new Set<string>();

function reportSkipped(skipped: ReadonlyMap<string, number>): void {
  for (const [key, count] of skipped) {
    if (reportedSkips.has(key)) continue;
    reportedSkips.add(key);
    console.warn(
      `[op-log] skipped ${count} op-log line(s) this reader cannot fold (${key}) — written by a newer or foreign writer`,
    );
  }
}

/** Every op in the live log, folded through the one reducer. */
export function readOpStates(): Map<string, OpFoldState> {
  return foldOpLines(readOpLines());
}

/**
 * Every op the host knows about, folded from the live op log into read-model
 * records.
 *
 * `Date.now()` and the sleep clock are read ONCE here and injected into the
 * fold, so all in-flight bars on one read share a single clock (and so the fold
 * stays pure/testable).
 */
export function readOpRecords(): OpRecord[] {
  return toOpRecords(readOpStates().values(), Date.now(), readSleepNow());
}

/**
 * The declared wait op `opId` is parked in right now (`host-grant`,
 * `duress-valve`, …), or `null` when it is working, has ended, or is not in the
 * live log at all. Lets a process waiting BEHIND that op tell a holder that is
 * queued from one that is stuck.
 */
export function readOpenWait(opId: string): OpenWait | null {
  const state = readOpStates().get(opId);
  if (!state || state.closedBy !== null) return null;
  return state.openWait;
}

/**
 * `readOpenWait` plus the op's place in that wait's line (`waitersAhead` over
 * every in-flight op in the log; `null` when the wait is no first-come line or
 * the op's identity is not in the live log yet).
 */
export function readOpenWaitInLine(
  opId: string,
): { wait: OpenWait; ahead: number | null } | null {
  const states = readOpStates();
  const state = states.get(opId);
  if (!state || state.closedBy !== null || !state.openWait) return null;
  const lineOp = (s: typeof state): LineOp | null =>
    s.identity && s.closedBy === null
      ? { kind: s.identity.kind, lane: s.identity.lane, openWait: s.openWait }
      : null;
  const self = lineOp(state);
  if (!self) return { wait: state.openWait, ahead: null };
  const inFlight = [...states.values()].flatMap((s) => lineOp(s) ?? []);
  return { wait: state.openWait, ahead: waitersAhead(self, inFlight) };
}
