import type { ResourceResult } from "@plugins/network/plugins/live/plugins/live-state/web";
import type { HealthStatus } from "@plugins/shell/plugins/health-report/web";
import type { DateFormatter } from "@plugins/fields/plugins/date/plugins/format/core";
import type { BackupHealth } from "../../core";

export interface BackupVerdict {
  status: HealthStatus;
  /**
   * The next instant this verdict changes on its own — the schedule's
   * `staleAt` while it is still ahead — or null when nothing is waiting. The
   * hook arms exactly one timer to it; there is no polling.
   */
  nextChangeAt: number | null;
}

/**
 * The health report's Backup row, from the `backup.health` value and `now`.
 *
 * - activated, latest finished run `ok` → green;
 * - latest finished run `partial` or `failed` (a run with no storage target
 *   enabled is recorded `failed`) → attention;
 * - the schedule missed a whole firing since the latest run started (its
 *   `staleAt` passed) → attention, whatever that run's outcome: the schedule
 *   has stopped, and an ever-older "Last backup" must not stay green;
 * - not activated (no schedule), or a backend that is not main →
 *   `not-applicable`: drawn hollow with why, and left out of the merge, so it
 *   never moves the dot;
 * - activated but never run yet → `info`: nothing is wrong, but nothing is
 *   backed up yet either, so green would overclaim.
 *
 * A run in progress pulses the row; the verdict stays the latest finished
 * run's until it ends.
 */
export function backupVerdict(
  result: ResourceResult<BackupHealth>,
  now: number,
  fmt: DateFormatter,
): BackupVerdict {
  if (result.status === "loading") {
    return { status: { state: "unknown" }, nextChangeAt: null };
  }
  if (result.status === "error") {
    return {
      status: { state: "unknown", summary: "Couldn't read the backup state" },
      nextChangeAt: null,
    };
  }
  const h = result.data;
  switch (h.kind) {
    case "elsewhere":
      return {
        status: {
          state: "not-applicable",
          summary: "Backups run from main — see it there",
        },
        nextChangeAt: null,
      };
    case "inactive":
      return {
        status: {
          state: "not-applicable",
          summary: "Not activated — no backup schedule set",
        },
        nextChangeAt: null,
      };
    case "active": {
      const staleAt = h.owed?.staleAt ?? null;
      if (staleAt !== null && now >= staleAt) {
        const since =
          h.last === null
            ? "No backup has finished"
            : `No backup since ${fmt.dateTime(h.last.finishedAt)}`;
        const due =
          h.owed?.dueAt != null
            ? ` — one was due ${fmt.dateTime(h.owed.dueAt)}`
            : "";
        return {
          status: {
            state: "attention",
            title: "Scheduled backups stopped",
            summary: `${since}${due}`,
            transitioning: h.running,
          },
          nextChangeAt: null,
        };
      }
      return { status: activeStatus(h, fmt), nextChangeAt: staleAt };
    }
  }
}

function activeStatus(
  h: Extract<BackupHealth, { kind: "active" }>,
  fmt: DateFormatter,
): HealthStatus {
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
