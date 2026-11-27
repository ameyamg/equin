import { and, desc, isNotNull, isNull, ne } from "drizzle-orm";
import { db } from "@plugins/database/server";
import { getConfig, watchConfig } from "@plugins/config_v2/server";
import type { ConfigDescriptor } from "@plugins/config_v2/core";
import type { FieldsRecord } from "@plugins/fields/core";
import { isMain } from "@plugins/infra/plugins/runtime-identity/core";
import { serveValue } from "@plugins/network/plugins/live/server";
import { backupHealth, type BackupHealth } from "@plugins/backup/core";
import { backupConfig } from "../../shared/config";
import { BackupTarget } from "./contribution";
import { _backupRuns } from "./tables";

/**
 * The Backup health row's answer.
 *
 * Activation is read from the CURRENT config. The schedule itself is read
 * once at worker startup (`backupRunJob`), so a cron just set takes effect on
 * the next restart — the row says "activated" a little early, never late.
 */
export async function loadBackupHealth(): Promise<BackupHealth> {
  if (!isMain()) return { kind: "elsewhere" };
  if (getConfig(backupConfig).periodicCron.trim() === "") {
    return { kind: "inactive", reason: "no-schedule" };
  }
  const anyTarget = BackupTarget.getContributions().some(
    (t) => getConfig(t.enabledBy).enabled,
  );
  if (!anyTarget) return { kind: "inactive", reason: "no-target" };

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

  return {
    kind: "active",
    running: running !== undefined,
    last:
      last === undefined ||
      last.finishedAt === null ||
      last.status === "running"
        ? null
        : { status: last.status, finishedAt: last.finishedAt.getTime() },
  };
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
// recomputes it; the configs (backup's own and each target's enabled switch)
// are watched for as long as a tab reads the value.
export const backupHealthServed = serveValue(backupHealth, {
  source: "external",
  changes: "notified",
  reads: {
    tables: [_backupRuns],
    reason: "the latest finished backup run's outcome, and whether one runs",
  },
  whileSubscribed: (_params, notify) => {
    const stops = [
      onConfigChange(backupConfig, notify),
      ...BackupTarget.getContributions().map((t) =>
        onConfigChange(t.enabledBy, notify),
      ),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  },
  loader: loadBackupHealth,
});
