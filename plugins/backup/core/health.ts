import { z } from "zod";
import { liveValue } from "@plugins/network/plugins/live/core";

/**
 * What the health report's Backup row needs, as one small value.
 *
 * - `elsewhere` — this backend is not main. Backups are host-global and run
 *   from main only (the schedule is main-only); a worktree's `backup_runs` is a
 *   frozen copy of main's, forked when the worktree was, so its latest row
 *   says nothing about today.
 * - `inactive` — no backup will run on its own: no schedule (`periodicCron`
 *   empty, manual only).
 * - `active` — the latest FINISHED run's outcome (`null` before the first one),
 *   whether one is running now, and when the schedule owes the next run. A run
 *   with no storage target enabled is recorded `failed`, so it reaches this
 *   row like any other failure.
 */
export const BackupHealthSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("elsewhere") }),
  z.object({
    kind: z.literal("inactive"),
    reason: z.literal("no-schedule"),
  }),
  z.object({
    kind: z.literal("active"),
    running: z.boolean(),
    last: z
      .object({
        status: z.enum(["ok", "partial", "failed"]),
        /** Epoch ms. */
        finishedAt: z.number(),
      })
      .nullable(),
    /**
     * When the schedule owes a newer run than the latest one STARTED (running
     * or finished — a run in progress is the schedule firing; a run wedged in
     * progress is not, and ages like any other). Read from `periodicCron`
     * alone, never a hand-set threshold:
     *
     * - `dueAt` — the cron's first firing after that start: a newer run should
     *   exist from then.
     * - `staleAt` — its second: one whole firing missed, so the schedule has
     *   stopped (a wedged job, a cron misread, main down), not merely run late
     *   or retried.
     *
     * Epoch ms, `null` when the cron fires no more within its lookahead; the
     * whole object `null` before any run.
     */
    owed: z
      .object({ dueAt: z.number().nullable(), staleAt: z.number().nullable() })
      .nullable(),
  }),
]);
export type BackupHealth = z.infer<typeof BackupHealthSchema>;

/**
 * The Backup health row's value. Pushed: identical for every tab and read by
 * the always-mounted health dot. Recomputed on every `backup_runs` write and
 * on every change of the backup config. Its `staleAt` moving into the past
 * changes the verdict with no write at all; the reader arms one timer to it.
 */
export const backupHealth = liveValue("backup.health", {
  schema: BackupHealthSchema,
});
