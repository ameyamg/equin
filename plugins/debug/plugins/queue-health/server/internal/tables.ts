import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// The dead-job deaths the watchdog already reported (`machine/internal/
// dead-job-ledger.ts`). A dead row sits in the queue until the dead-job GC
// archives it — up to an hour — and the watchdog samples the queue every five
// minutes, so without this ledger every sample filed the same death again
// (2026-11-17: `desktop.fullscreen-budget` run 25ff3aa9 filed 10× in 45 min).
// One row per death the queue still holds (`deathId`: the jobs plugin's
// identity of one death of one row); a death that has left the queue is pruned
// on the next check, so the table is bounded by the dead set itself. A table,
// not process memory: a restart (every deploy) must not report the queue's
// dead rows a second time.
export const _queueDeadJobsReported = pgTable("queue_dead_jobs_reported", {
  deathId: text("death_id").primaryKey(),
  reportedAt: timestamp("reported_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
