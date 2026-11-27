import { z } from "zod";
import { liveValue } from "@plugins/network/plugins/live/core";

/**
 * What the health report's Backup row needs, as one small value.
 *
 * - `elsewhere` — this backend is not main. Backups are host-global and run
 *   from main only (the schedule is main-only); a worktree's `backup_runs` is a
 *   frozen copy of main's, forked when the worktree was, so its latest row
 *   says nothing about today.
 * - `inactive` — no backup will run: no schedule (`periodicCron` empty, manual
 *   only), or a schedule but no storage target enabled — a run would record
 *   `ok` while storing the archive nowhere.
 * - `active` — the latest FINISHED run's outcome (`null` before the first one),
 *   and whether one is running now.
 */
export const BackupHealthSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("elsewhere") }),
  z.object({
    kind: z.literal("inactive"),
    reason: z.enum(["no-schedule", "no-target"]),
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
  }),
]);
export type BackupHealth = z.infer<typeof BackupHealthSchema>;

/**
 * The Backup health row's value. Pushed: identical for every tab and read by
 * the always-mounted health dot. Recomputed on every `backup_runs` write and
 * on every change of the backup config or a target's enabled config.
 */
export const backupHealth = liveValue("backup.health", {
  schema: BackupHealthSchema,
});
