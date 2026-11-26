import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@plugins/database/server";
import { runtimeNamespace } from "@plugins/infra/plugins/runtime-identity/core";
import {
  runInBackgroundLane,
  runWithoutProfiling,
} from "@plugins/infra/plugins/runtime-profiler/core";
import { createKeyedMutex } from "@plugins/packages/plugins/keyed-mutex/core";
import type { ProducerExecutor } from "@plugins/network/plugins/live/plugins/change-feed/server";
import { _reports, ReportKind } from "@plugins/reports/server";
import {
  reportIdKind,
  reportMessageOrDerived,
  type ReportInput,
} from "@plugins/reports/core";
import { reportsProducer } from "./producer";
import { recordReport, type RecordReportResult } from "./record-report";
import { _reportStandingConditions } from "./tables";

/** One condition an audit sees now, under the fingerprint it is filed on. */
export interface StandingCondition {
  fingerprint: string;
  input: ReportInput;
}

/**
 * What one sync did:
 * - `filed` — each condition with no standing row, filed through
 *   `recordReport` (a new row, or a new occurrence of the row it came back on);
 * - `standing` — the fingerprints already standing: nothing written;
 * - `cleared` — each condition the audit no longer sees: its standing row is
 *   gone, and its report `closed` (deleted) when nobody took it up — no task,
 *   no fix claimed. A report with a task or a fix stays for them, and a later
 *   occurrence of the condition lands on it (a fixed one regresses).
 */
export interface StandingSyncResult {
  filed: { fingerprint: string; result: RecordReportResult }[];
  standing: string[];
  cleared: { fingerprint: string; reportId: string; closed: boolean }[];
}

// One sync per kind at a time: a boot audit and a discard's re-audit must not
// both see a condition unmarked and file it twice.
const syncs = createKeyedMutex("reports.standing-sync");

/**
 * Sync a kind's STANDING conditions: facts an audit re-observes on every run
 * (a boot, an hourly pass) while they last — not events that recur. The audit
 * hands over EVERY condition of `kind` it sees now, so a report's lifetime
 * follows its condition with nothing for the caller to remember:
 *
 * - a condition that is new (or came back after it cleared) is filed once,
 *   through `recordReport` (row, bell, fan-out and shed as usual);
 * - re-observing one that stands is not another occurrence: `count` counts the
 *   times the condition arose, never the times something looked;
 * - one no longer seen is cleared, and its report closed when nobody took it
 *   up (see {@link StandingSyncResult}).
 *
 * Each input's fingerprint must name the condition itself (one stranded
 * config), not the audit. Only the serving backend syncs: the reads and the
 * writes must see the same `reports` table, and the outbox would record every
 * hand-off as an occurrence.
 */
export async function syncStandingReports(
  kind: string,
  inputs: readonly ReportInput[],
): Promise<StandingSyncResult> {
  if (!reportsProducer.writesHere()) {
    throw new Error(
      `syncStandingReports: kind "${kind}" synced from a process that cannot write reports — standing reports are synced by the serving backend only`,
    );
  }
  const spec = ReportKind.getContributions().find((k) => k.kind === kind);
  if (!spec) {
    throw new Error(
      `syncStandingReports: no ReportKind registered for kind "${kind}"`,
    );
  }
  const conditions: StandingCondition[] = [];
  for (const input of inputs) {
    if (input.kind !== kind) {
      throw new Error(
        `syncStandingReports: a "${input.kind}" report handed to the "${kind}" sync`,
      );
    }
    // The same fingerprint recordReport derives: the raw message and the
    // parsed payload, so the standing row names the row it upserts.
    conditions.push({
      fingerprint: await spec.fingerprint(spec.schema.parse(input.data), {
        message: reportMessageOrDerived(input),
        source: input.source,
      }),
      input,
    });
  }
  return await syncs.run(kind, () =>
    runInBackgroundLane(() =>
      runWithoutProfiling(() =>
        syncStandingConditions(db, {
          kind,
          worktree: runtimeNamespace(),
          conditions,
          file: recordReport,
        }),
      ),
    ),
  );
}

/**
 * The sync itself, over an executor and a filer — exported for its suite,
 * which runs it against a throwaway database.
 */
export async function syncStandingConditions(
  executor: ProducerExecutor,
  args: {
    kind: string;
    worktree: string;
    conditions: readonly StandingCondition[];
    file: (input: ReportInput) => Promise<RecordReportResult>;
  },
): Promise<StandingSyncResult> {
  const t = _reportStandingConditions;
  const marks = await executor
    .select({ fingerprint: t.fingerprint, reportId: t.reportId })
    .from(t)
    .where(and(eq(t.worktree, args.worktree), eq(t.kind, args.kind)));
  const marked = new Map(marks.map((m) => [m.fingerprint, m.reportId]));
  const seen = new Set(args.conditions.map((c) => c.fingerprint));

  const result: StandingSyncResult = { filed: [], standing: [], cleared: [] };
  for (const c of args.conditions) {
    if (marked.has(c.fingerprint)) {
      result.standing.push(c.fingerprint);
      continue;
    }
    const filed = await args.file(c.input);
    result.filed.push({ fingerprint: c.fingerprint, result: filed });
    // Shed or folded into a storm: no row to stand on — the next audit files
    // it again.
    if (filed.outcome !== "recorded") continue;
    await executor
      .insert(t)
      .values({
        fingerprint: c.fingerprint,
        worktree: args.worktree,
        kind: args.kind,
        reportId: reportIdKind.key(filed.reportId),
      })
      .onConflictDoNothing();
  }

  const gone = marks.filter((m) => !seen.has(m.fingerprint));
  if (gone.length === 0) return result;
  await executor.delete(t).where(
    and(
      eq(t.worktree, args.worktree),
      inArray(
        t.fingerprint,
        gone.map((m) => m.fingerprint),
      ),
    ),
  );
  // Close what nobody took up: a report with a task is the task's to close,
  // and one a commit claims fixed is the fix ledger's (retention's own rule).
  const closed = new Set(
    (
      await reportsProducer.mutate(
        executor,
        (q, r) =>
          q.delete(r).where(
            and(
              inArray(
                r.id,
                gone.map((m) => m.reportId),
              ),
              isNull(r.taskId),
              eq(r.fixState, "open"),
            ),
          ),
        { latency: "background", returning: { id: _reports.id } },
      )
    ).map((r): string => r.id),
  );
  for (const m of gone) {
    result.cleared.push({
      fingerprint: m.fingerprint,
      reportId: m.reportId,
      closed: closed.has(m.reportId),
    });
  }
  return result;
}
