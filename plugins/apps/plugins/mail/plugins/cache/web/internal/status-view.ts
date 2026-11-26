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

/** How changes arrive, in words: pushed, or the fallback and why. */
function arrival(
  signal: Extract<MailAccountStatus, { kind: "account" }>["changeSignal"],
): string {
  const { push, ticking, everyMs, idleEveryMs } = signal;
  if (push.kind === "live") return "instant updates (push)";
  const fallback = ticking
    ? `checking every ${every(everyMs)} while Mail is open`
    : idleEveryMs === null
      ? "checked when Mail is opened"
      : `checking every ${every(idleEveryMs)}`;
  switch (push.kind) {
    case "none":
      return fallback;
    case "not-set-up":
      return `${fallback} (instant updates not set up)`;
    case "starting":
      return `${fallback} (instant updates connecting…)`;
    case "down":
      return `${fallback} (instant updates down)`;
  }
}

/**
 * The Mail row. Absent until Mail has been opened with an account (nothing
 * cached, nothing to say); attention while the account needs reconnecting,
 * the last sync step failed, or push is set up but down (changes then come
 * by the slower fallback); unknown (still) while offline; ok once synced,
 * saying how changes arrive — pushed, or the fallback tick.
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
  const push = s.changeSignal.push;
  if (push.kind === "down")
    return {
      state: "attention",
      title: "Mail instant updates down",
      summary: `Since ${clock(push.since)}: ${push.message} — ${arrival(s.changeSignal)}`,
    };
  if (s.syncedAt === null)
    return {
      state: "ok",
      summary: `${s.address} · first sync…`,
      transitioning: true,
    };
  return {
    state: "ok",
    summary: `${s.address} · synced ${clock(s.syncedAt)}, ${arrival(s.changeSignal)}`,
  };
}
