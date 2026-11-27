import {
  asPerfMs,
  perfToEpoch,
} from "@plugins/primitives/plugins/perfs/plugins/page-clock/core";
import { runInBackgroundLane } from "@plugins/infra/plugins/runtime-profiler/core";
import {
  getProfilingData,
  whenReplaySettled,
} from "@plugins/framework/plugins/server-core/core";
import {
  restateReportOccurrence,
  type RecordReportResult,
} from "@plugins/reports/plugins/engine/server";
import {
  createFindingsBook,
  createRestartWindow,
  judgeFinding,
  type Finding,
  type FindingVerdict,
  type OpenEndToEnd,
} from "./findings";

// This process's half of "was a person waiting?" (./findings.ts): its restart
// replay's window and the book of findings every end-to-end report draws its
// evidence from. One per backend, in memory — a finding from the predecessor
// is not attached to a report its successor receives (the predecessor's work
// after the swap is its drain: background).

export const restartWindow = createRestartWindow({
  // `timeToReadyMs` is on the process-start axis (`performance.timeOrigin`),
  // null until ready and in a host that never serves.
  readyAt: () => {
    const t = getProfilingData().timeToReadyMs;
    return t === null ? null : perfToEpoch(asPerfMs(t));
  },
  // Already armed by `serve` at its ready barrier (the same promise): this is
  // only ever read once ready.
  replaySettled: whenReplaySettled,
});

export const findingsBook = createFindingsBook({
  now: Date.now,
  restate: (e, findings) => {
    // Intentional fire-and-forget: a failed restate rejects loudly (the crash
    // collector files it); the report already stands with what it had.
    void runInBackgroundLane(() =>
      restateReportOccurrence({
        reportId: e.reportId,
        kind: "slow-op",
        occurredAt: e.occurredAt,
        message: e.message,
        data: { ...e.data, findings },
      }),
    );
  },
});

/** Judge a finding against this process's restart replay (./findings.ts). */
export function judge(f: Finding): Promise<FindingVerdict> {
  return judgeFinding(f, restartWindow);
}

/**
 * The one entry for a per-op monitor outside slow-ops (op-rate's boot
 * window, boot-budget's hooks): judged first; evidence is noted and files
 * nothing, anything else is filed by `file` and noted with its report.
 */
export async function fileFinding(
  f: Finding,
  file: () => Promise<RecordReportResult>,
): Promise<FindingVerdict> {
  const verdict = await judge(f);
  if (verdict.kind === "evidence") {
    findingsBook.note(f, verdict);
    return verdict;
  }
  const result = await file();
  findingsBook.note(
    f,
    verdict,
    result.outcome === "recorded" ? result.reportId : undefined,
  );
  return verdict;
}

export type { Finding, FindingVerdict, OpenEndToEnd };
