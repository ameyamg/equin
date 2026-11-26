import { and, eq } from "drizzle-orm";
import { db } from "@plugins/database/server";
import { runtimeNamespace } from "@plugins/infra/plugins/runtime-identity/core";
import {
  runInBackgroundLane,
  runWithoutProfiling,
} from "@plugins/infra/plugins/runtime-profiler/core";
import { _reports, ReportKind } from "@plugins/reports/server";
import {
  reportMessageOrDerived,
  type ReportInput,
} from "@plugins/reports/core";
import { reportsProducer } from "./producer";
import { recordReport, type RecordReportResult } from "./record-report";

/**
 * What became of a standing report:
 * - every {@link RecordReportResult} arm — the condition had no row yet, so it
 *   was filed through `recordReport` (row, bell, fan-out and shed as usual);
 * - `standing` — a row of this fingerprint already holds it: nothing written,
 *   nothing rings, `count` unmoved.
 */
export type StandingReportResult =
  RecordReportResult | { outcome: "standing"; reportId: string };

/**
 * File a STANDING condition: a fact an audit re-observes on every run (a boot,
 * an hourly pass) while it lasts — not an event that recurs. It is filed once,
 * the first time an audit sees it, and re-observing it while its row lives is
 * not another occurrence: `count` counts the times the condition arose, never
 * the times something looked. A new condition is a new fingerprint, so it is
 * news exactly once; a condition whose row retention swept (uninvestigated for
 * 7 days) is filed again — a reminder, not a recurrence.
 *
 * The caller picks it per condition (its fingerprint must name the condition,
 * not the audit); a kind still cannot opt out of the bell — the first filing
 * rings it as any report does.
 *
 * Only the serving backend files one: the existing-row read and the write must
 * see the same `reports` table, and the outbox would record every hand-off as
 * an occurrence.
 */
export async function recordStandingReport(
  input: ReportInput,
): Promise<StandingReportResult> {
  if (!reportsProducer.writesHere()) {
    throw new Error(
      `recordStandingReport: kind "${input.kind}" filed from a process that cannot write reports — a standing report is filed by the serving backend only`,
    );
  }
  const spec = ReportKind.getContributions().find((k) => k.kind === input.kind);
  if (!spec) {
    throw new Error(
      `recordStandingReport: no ReportKind registered for kind "${input.kind}"`,
    );
  }
  // The same fingerprint recordReport derives: the raw message and the parsed
  // payload, so the row looked up is the row it would upsert.
  const fingerprint = await spec.fingerprint(spec.schema.parse(input.data), {
    message: reportMessageOrDerived(input),
    source: input.source,
  });
  const [existing] = await runInBackgroundLane(() =>
    runWithoutProfiling(
      async () =>
        await db
          .select({ id: _reports.id })
          .from(_reports)
          .where(
            and(
              eq(_reports.fingerprint, fingerprint),
              eq(_reports.worktree, runtimeNamespace()),
            ),
          )
          .limit(1),
    ),
  );
  if (existing) return { outcome: "standing", reportId: existing.id };
  return recordReport(input);
}
