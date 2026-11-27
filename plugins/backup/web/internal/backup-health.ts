import type { ResourceResult } from "@plugins/network/plugins/live/plugins/live-state/web";
import type { HealthStatus } from "@plugins/shell/plugins/health-report/web";
import type { DateFormatter } from "@plugins/fields/plugins/date/plugins/format/core";
import type { BackupHealth } from "../../core";

/**
 * The health report's Backup row, from the `backup.health` value.
 *
 * - activated, latest finished run `ok` → green;
 * - latest finished run `partial` or `failed` → attention;
 * - not activated (no schedule, or no storage target enabled), or a backend
 *   that is not main → `not-applicable`: drawn hollow with why, and left out
 *   of the merge, so it never moves the dot;
 * - activated but never run yet → `info`: nothing is wrong, but nothing is
 *   backed up yet either, so green would overclaim.
 *
 * A run in progress pulses the row; the verdict stays the latest finished
 * run's until it ends.
 */
export function backupHealthStatus(
  result: ResourceResult<BackupHealth>,
  fmt: DateFormatter,
): HealthStatus {
  if (result.status === "loading") return { state: "unknown" };
  if (result.status === "error") {
    return { state: "unknown", summary: "Couldn't read the backup state" };
  }
  const h = result.data;
  switch (h.kind) {
    case "elsewhere":
      return {
        state: "not-applicable",
        summary: "Backups run from main — see it there",
      };
    case "inactive":
      return {
        state: "not-applicable",
        summary:
          h.reason === "no-schedule"
            ? "Not activated — no backup schedule set"
            : "Not activated — no storage target enabled",
      };
    case "active": {
      const running = h.running ? " · backing up now" : "";
      if (h.last === null) {
        return {
          state: "info",
          summary: h.running ? "First backup running" : "No backup has run yet",
          transitioning: h.running,
        };
      }
      const when = fmt.dateTime(h.last.finishedAt);
      switch (h.last.status) {
        case "ok":
          return {
            state: "ok",
            summary: `Last backup ${when}${running}`,
            transitioning: h.running,
          };
        case "partial":
          return {
            state: "attention",
            title: "Last backup was partial",
            summary: `Some sources or targets were missed, ${when}${running}`,
            transitioning: h.running,
          };
        case "failed":
          return {
            state: "attention",
            title: "Last backup failed",
            summary: `Nothing was stored, ${when}${running}`,
            transitioning: h.running,
          };
      }
    }
  }
}
