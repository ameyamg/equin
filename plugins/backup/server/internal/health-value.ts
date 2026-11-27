import { and, desc, isNotNull, isNull, ne } from "drizzle-orm";
import { db } from "@plugins/database/server";
import { getConfig, watchConfig } from "@plugins/config_v2/server";
import type { ConfigDescriptor } from "@plugins/config_v2/core";
import type { FieldsRecord } from "@plugins/fields/core";
import {
  nextCronFiring,
  parseCrontab,
  type Crontab,
} from "@plugins/infra/plugins/jobs/core";
import { isMain } from "@plugins/infra/plugins/runtime-identity/core";
import { serveValue } from "@plugins/network/plugins/live/server";
import { backupHealth, type BackupHealth } from "@plugins/backup/core";
import { backupConfig } from "../../shared/config";
import { _backupRuns } from "./tables";

/**
 * The Backup health row's answer.
 *
 * Activation and the owed-run instants are read from the CURRENT config. The
 * schedule itself is read once at worker startup (`backupRunJob`), so a cron
 * just set takes effect on the next restart — the row judges by it a little
 * early, never late.
 */
export async function loadBackupHealth(): Promise<BackupHealth> {
  if (!isMain()) return { kind: "elsewhere" };
  const cron = getConfig(backupConfig).periodicCron.trim();
  if (cron === "") return { kind: "inactive", reason: "no-schedule" };
  const tab = parseCrontab(cron);

  const [last] = await db
    .select({ status: _backupRuns.status, finishedAt: _backupRuns.finishedAt })
    .from(_backupRuns)
    .where(
      and(isNotNull(_backupRuns.finishedAt), ne(_backupRuns.status, "running")),
    )
    .orderBy(desc(_backupRuns.finishedAt))
    .limit(1);
  const [running] = await db
    .select({ id: _backupRuns.id })
    .from(_backupRuns)
    .where(isNull(_backupRuns.finishedAt))
    .limit(1);
  const [latestStart] = await db
    .select({ startedAt: _backupRuns.startedAt })
    .from(_backupRuns)
    .orderBy(desc(_backupRuns.startedAt))
    .limit(1);

  return {
    kind: "active",
    running: running !== undefined,
    last:
      last === undefined ||
      last.finishedAt === null ||
      last.status === "running"
        ? null
        : { status: last.status, finishedAt: last.finishedAt.getTime() },
    owed:
      latestStart === undefined ? null : owedAfter(tab, latestStart.startedAt),
  };
}

/** The schedule's first and second firings after a run started. */
export function owedAfter(
  tab: Crontab,
  startedAt: Date,
): { dueAt: number | null; staleAt: number | null } {
  const due = nextCronFiring(tab, startedAt);
  const stale = due === null ? null : nextCronFiring(tab, due);
  return { dueAt: due?.getTime() ?? null, staleAt: stale?.getTime() ?? null };
}

/**
 * Notify on every change of one config descriptor. `watchConfig` calls back
 * at once with the current values — not a change, so skipped.
 */
function onConfigChange<F extends FieldsRecord>(
  descriptor: ConfigDescriptor<F>,
  notify: () => void,
): () => void {
  let initial = true;
  const watcher = watchConfig(descriptor, () => {
    if (!initial) notify();
  });
  initial = false;
  return () => watcher.dispose();
}

// External: half of the truth is config on disk, which the change feed cannot
// see. `backup_runs` is declared in `reads`, so a run claimed or closed
// recomputes it; the backup config (the schedule) is watched for as long as a
// tab reads the value. Time passing needs no recompute: the value carries the
// instants it goes stale at, and the reader times them.
export const backupHealthServed = serveValue(backupHealth, {
  source: "external",
  changes: "notified",
  reads: {
    tables: [_backupRuns],
    reason:
      "the latest finished backup run's outcome, whether one runs, and the latest run's start",
  },
  whileSubscribed: (_params, notify) => onConfigChange(backupConfig, notify),
  loader: loadBackupHealth,
});
