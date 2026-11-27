import { useLive } from "@plugins/network/plugins/live/web";
import type { HealthStatus } from "@plugins/shell/plugins/health-report/web";
import { useDateFormatter } from "@plugins/fields/plugins/date/plugins/format/web";
import { backupHealth } from "../../core";
import { backupHealthStatus } from "./backup-health";

/** The Backup row's `useStatus`: one subscription to a small pushed value. */
export function useBackupHealth(): HealthStatus {
  return backupHealthStatus(useLive(backupHealth), useDateFormatter());
}
