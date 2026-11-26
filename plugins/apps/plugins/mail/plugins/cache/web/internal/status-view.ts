import type {
  ResourceResult,
  ResourceUnavailable,
} from "@plugins/network/plugins/live/plugins/live-state/web";
import type { HealthStatus } from "@plugins/shell/plugins/health-report/web";
import type { MailAccountStatus } from "../../core";

/** One read as `useLive` hands it back — a value read may be `unavailable`. */
export type Read<T> = ResourceResult<T> | ResourceUnavailable;

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function every(ms: number): string {
  return ms % 60_000 === 0 ? `${ms / 60_000} min` : `${ms / 1000} s`;
}

/**
 * The Mail row. Absent until Mail has been opened with an account (nothing
 * cached, nothing to say); attention while the account needs reconnecting or
 * the last sync step failed; unknown (still) while offline; ok once synced,
 * saying how changes arrive — the fallback tick, until push exists.
 */
export function mailHealth(read: Read<MailAccountStatus>): HealthStatus {
  if (read.status === "unavailable") return { state: "absent" };
  if (read.status === "loading") return { state: "unknown" };
  if (read.status === "error")
    return { state: "unknown", summary: "Couldn't read the mail account" };
  const s = read.data;
  switch (s.kind) {
    case "none":
      return { state: "absent" };
    case "not-connected":
      return {
        state: "attention",
        title: "Mail not connected",
        summary: `${s.address} needs reconnecting: ${s.message}`,
      };
    case "account":
      break;
  }
  if (s.connection === "offline" || s.syncFailure?.kind === "offline")
    return {
      state: "unknown",
      summary: `Offline — showing cached mail${s.syncedAt === null ? "" : `, synced ${clock(s.syncedAt)}`}`,
    };
  if (s.syncFailure !== null)
    return {
      state: "attention",
      title: "Mail sync failing",
      summary: `Since ${clock(s.syncFailure.at)}: ${s.syncFailure.message}`,
    };
  const { watching, everyMs, idleEveryMs } = s.changeSignal;
  const how = watching
    ? `checking every ${every(everyMs)} while Mail is open`
    : idleEveryMs === null
      ? "checked when Mail is opened"
      : `checking every ${every(idleEveryMs)}`;
  if (s.syncedAt === null)
    return {
      state: "ok",
      summary: `${s.address} · first sync…`,
      transitioning: true,
    };
  return {
    state: "ok",
    summary: `${s.address} · synced ${clock(s.syncedAt)}, ${how} (no push yet)`,
  };
}
