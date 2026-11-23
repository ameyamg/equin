import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@plugins/database/server";
import { defineJob } from "@plugins/infra/plugins/jobs/server";
import { isHostSingleton } from "@plugins/infra/plugins/paths/core";
import { defineWarmup } from "@plugins/infra/plugins/warmup/server";
import { reportIdKind, type ReportCategory } from "@plugins/reports/core";
import { _reports, ReportKind, ReportRecorded } from "@plugins/reports/server";
import { investigateReport } from "@plugins/reports/plugins/engine/server";
import { _supervisorEventRoutes } from "@plugins/tasks/plugins/supervisor-roles/plugins/events/server";
import { parseSavedSymbolName } from "@plugins/ui/plugins/icons/plugins/saved-names/core";
import { SupervisorEventStream } from "@plugins/tasks/plugins/supervisor-roles/plugins/events/server";
import { publishSupervisorEvent } from "@plugins/tasks/plugins/supervisor-roles/plugins/events/machine";

/**
 * The stream each report category feeds, and what the stream does with a
 * report: `announce` it (one event per occurrence, gathered into the routed
 * role's next message), or `own` it — give the report its ONE investigation
 * task, in the backlog of the role the stream is routed to (a plain task while
 * it is routed to none). Owning is for reports that are each a unit of work
 * with a fix to land: a broken test is fixed by one change, closed by the fix
 * ledger — one report, one task, never one message per occurrence.
 */
const STREAM_OF: Record<
  ReportCategory,
  { id: string; does: "announce" | "own" }
> = {
  error: { id: "error-reports", does: "announce" },
  "slow-op": { id: "slow-op-reports", does: "announce" },
  test: { id: "broken-tests", does: "own" },
};

function kindsOf(category: ReportCategory): string[] {
  return ReportKind.getContributions()
    .filter((k) => k.meta.category === category)
    .map((k) => k.kind);
}

export const errorReportsStream = SupervisorEventStream({
  id: STREAM_OF.error.id,
  label: "Error reports",
  icon: parseSavedSymbolName("bug-report"),
  description: "Crashes, failed requests and broken invariants main records",
  kinds: () => kindsOf("error"),
});

export const slowOpReportsStream = SupervisorEventStream({
  id: STREAM_OF["slow-op"].id,
  label: "Slow-op reports",
  icon: parseSavedSymbolName("speed"),
  description: "Stalls, slow interactions and blown budgets",
  kinds: () => kindsOf("slow-op"),
});

export const brokenTestsStream = SupervisorEventStream({
  id: STREAM_OF.test.id,
  label: "Broken tests",
  icon: parseSavedSymbolName("science"),
  description:
    "Tests failing on main: each gets one fix task in this supervisor's backlog",
  kinds: () => kindsOf("test"),
});

/**
 * Give one report of an owning stream its investigation task: the
 * system's, in the backlog of the role the stream is routed to (unless the
 * route's kinds leave this kind out), else a plain task. Idempotent — a task
 * that still owns the report is reused (the bridge's `ownsReport`). Only the
 * host's own backend: a worktree's roles and reports are a fork of main's.
 */
async function ownReport(
  report: { id: string; kind: string },
  streamId: string,
): Promise<void> {
  if (!isHostSingleton()) return;
  const [route] = await db
    .select({
      roleId: _supervisorEventRoutes.roleId,
      kinds: _supervisorEventRoutes.kinds,
    })
    .from(_supervisorEventRoutes)
    .where(eq(_supervisorEventRoutes.streamId, streamId));
  const backlogOf =
    route !== undefined &&
    (route.kinds === null || route.kinds.includes(report.kind))
      ? route.roleId
      : null;
  await investigateReport(report.id, { kind: "system", backlogOf });
}

/**
 * Send one recorded report to its category's stream: one event per
 * occurrence, keyed by the report (its occurrences fold into one line) — or,
 * for a stream that owns its reports, the report's one task.
 */
export const reportEventJob = defineJob({
  name: "supervisor-events.report",
  description:
    "Sends a recorded report to the supervisor its category's event stream is routed to.",
  hold: "seconds",
  input: z.object({ reportId: z.string() }),
  event: z.never(),
  dedup: "none",
  run: async ({ input }) => {
    const [row] = await db
      .select({
        id: _reports.id,
        kind: _reports.kind,
        message: _reports.message,
        taskId: _reports.taskId,
      })
      .from(_reports)
      .where(eq(_reports.id, reportIdKind.key(input.reportId)));
    if (!row) return; // deleted since (retention): nothing to tell
    // Owned since it was recorded (a task about its subject took it in the
    // meantime — a failed build's Investigate): someone is on it, not news.
    if (row.taskId !== null) return;
    const spec = ReportKind.getContributions().find((k) => k.kind === row.kind);
    if (!spec) throw new Error(`No report kind "${row.kind}" is registered.`);
    const stream = STREAM_OF[spec.meta.category];
    if (stream.does === "own") {
      await ownReport(row, stream.id);
      return;
    }
    await publishSupervisorEvent({
      stream: stream.id,
      key: row.id,
      kind: row.kind,
      title: row.message,
      ref: row.id,
    });
  },
});

export const reportRecordedToStreams = ReportRecorded({
  id: "tasks.supervisor-roles.events.report-streams",
  onRecorded: (reportId) => void reportEventJob.enqueue({ reportId }),
});

/**
 * At boot, on the host's own backend: every still-open report of an owning
 * stream gets its task — the ones recorded before the stream owned them, and
 * the ones whose task was dropped: the occurrence listener only hears reports
 * with no linked task. (The bridge reuses a task that still owns one.)
 */
export const ownOpenReportsWarmup = defineWarmup({
  name: "supervisor-events.own-open-reports",
  description:
    "Gives every open report of a stream that owns its reports (Broken tests) its one investigation task, in the backlog of the supervisor the stream is routed to.",
  scope: "host",
  run: async () => {
    for (const [category, stream] of Object.entries(STREAM_OF)) {
      if (stream.does !== "own") continue;
      const kinds = kindsOf(category as ReportCategory);
      if (kinds.length === 0) continue;
      const rows = await db
        .select({ id: _reports.id, kind: _reports.kind })
        .from(_reports)
        .where(
          and(
            inArray(_reports.kind, kinds),
            inArray(_reports.fixState, ["open", "regressed"]),
            eq(_reports.noise, false),
          ),
        );
      for (const row of rows) await ownReport(row, stream.id);
    }
  },
});
