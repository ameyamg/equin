import type {
  ResourceResult,
  ResourceUnavailable,
} from "@plugins/network/plugins/live/plugins/live-state/web";
import type { HealthStatus } from "@plugins/shell/plugins/health-report/web";
import {
  installLabel,
  type DaemonBinaries,
  type DaemonDepRow,
} from "../../core";

/**
 * One daemon dependency's verdict: `ok` (running what main declares, or not
 * started yet; `note` when main declares another version the daemon takes at
 * its next start), `attention` (a start fell back from main's version), or
 * `unknown` (main's declaration unreadable).
 */
export type DaemonVerdict =
  | { level: "ok"; note?: string }
  | { level: "attention" | "unknown"; phrase: string };

export function daemonVerdict(row: DaemonDepRow): DaemonVerdict {
  const d = row.declared;
  switch (d.kind) {
    case "unreadable":
      return {
        level: "unknown",
        phrase: `${row.id}: couldn't read what main declares`,
      };
    case "same":
      return { level: "ok" };
    case "differs": {
      const to = installLabel(d.install);
      if (d.failed !== null) {
        return {
          level: "attention",
          phrase:
            row.running === null
              ? `${row.id} ${to} failed to start`
              : `${row.id} ${to} failed to start — running ${installLabel(row.running)}`,
        };
      }
      // Never started yet: the first start runs main's, nothing to say.
      if (row.running === null) return { level: "ok" };
      return { level: "ok", note: `${row.id} ${to} at next restart` };
    }
  }
}

/**
 * The Daemon binaries row's verdict: loading → `unknown` with no summary
 * (never `ok`); a host without the computer, a release or no daemon
 * dependency → `not-applicable`; otherwise the worst row's — `attention`
 * naming each start that fell back, `unknown` when one cannot be compared,
 * `ok` otherwise (with the versions waiting for a restart as its summary).
 */
export function daemonBinariesVerdict(
  result: ResourceResult<DaemonBinaries> | ResourceUnavailable,
): HealthStatus {
  if (result.status === "unavailable") {
    return { state: "not-applicable", summary: result.message };
  }
  if (result.status === "loading") return { state: "unknown" };
  if (result.status === "error") {
    return {
      state: "unknown",
      summary: "Couldn't load the daemon binaries' status",
    };
  }
  const data = result.data;
  switch (data.kind) {
    case "not-applicable":
      return { state: "not-applicable", summary: data.reason };
    case "unreadable":
      return {
        state: "unknown",
        summary: `Couldn't compare the daemon binaries: ${data.message}`,
      };
    case "checked": {
      const verdicts = data.rows.map(daemonVerdict);
      const phrases = verdicts.flatMap((v) =>
        v.level === "ok" ? [] : [v.phrase],
      );
      const notes = verdicts.flatMap((v) =>
        v.level === "ok" && v.note !== undefined ? [v.note] : [],
      );
      if (verdicts.some((v) => v.level === "attention")) {
        return {
          state: "attention",
          summary: phrases.join("; "),
          title: "A daemon fell back to its previous binaries",
        };
      }
      if (phrases.length > 0) {
        return { state: "unknown", summary: phrases.join("; ") };
      }
      return {
        state: "ok",
        summary: notes.length === 0 ? "Up to date with main" : notes.join("; "),
      };
    }
  }
}
