import { HealthResponseSchema } from "@plugins/infra/plugins/health/core";
import {
  PUBLIC_PATH_DOWN_MISSES,
  PUBLIC_PATH_GAP_MS,
  type ProbedPublicPath,
  type PublicPath,
  type PublicPathFailure,
} from "../core";

// The public-path probe's judgement, PURE: what one probe of a site's public
// URL saw, in; the next record out. No clock, no I/O — table-tested
// (`public-probe.test.ts`). The probe itself is the machine's
// (`machine/internal/public-probe.ts`).

/** What one probe saw: an HTTP answer (its status, `via`, body), or none. */
export type ProbeAnswer =
  | { kind: "answered"; status: number; via: string | null; body: string }
  | { kind: "no-answer"; error: string };

/** One probe's verdict: the site answered as equin, or how it failed. */
export type ProbeOutcome =
  { kind: "ok" } | { kind: "failed"; failure: PublicPathFailure };

/** Cloudflare's own origin-error statuses (520 unknown … 527 Railgun). */
function isCloudflareOriginError(status: number): boolean {
  return status >= 520 && status <= 527;
}

/** Caddy names itself in `via` (`1.1 Caddy`) on everything it proxies. */
function viaCaddy(via: string | null): boolean {
  return via !== null && /\bcaddy\b/i.test(via);
}

function bodyIsHealth(body: string): boolean {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch (err) {
    if (err instanceof SyntaxError) return false;
    throw err;
  }
  return HealthResponseSchema.safeParse(json).success;
}

/** Who answered, and whether it was equin. */
export function classifyProbe(answer: ProbeAnswer): ProbeOutcome {
  if (answer.kind === "no-answer") {
    return {
      kind: "failed",
      failure: { kind: "no-answer", error: answer.error },
    };
  }
  const { status, via, body } = answer;
  if (status === 200) {
    return bodyIsHealth(body)
      ? { kind: "ok" }
      : {
          kind: "failed",
          failure: {
            kind: "status",
            status,
            detail: "the answer is not equin's health check",
          },
        };
  }
  if (isCloudflareOriginError(status)) {
    return { kind: "failed", failure: { kind: "edge", status } };
  }
  if ((status === 502 || status === 503 || status === 504) && viaCaddy(via)) {
    return { kind: "failed", failure: { kind: "proxy", status } };
  }
  return {
    kind: "failed",
    failure: {
      kind: "status",
      status,
      detail: body.trim().slice(0, 200) || `HTTP ${String(status)}`,
    },
  };
}

/** The facts read at the probe's instant. */
export interface ProbeEnv {
  /** The SSH link is live: this computer is online and the box answers. */
  linkLive: boolean;
  /** A deploy run of the deployment is active: a restart is expected. */
  deployRunning: boolean;
}

/**
 * Whether a failed probe says something about the SITE (and so counts toward
 * down): never during a deploy; an HTTP answer always (something on the
 * internet answered); no answer only while the link is live — otherwise it
 * may be this computer's own network, or a probe right after a wake.
 */
function counts(failure: PublicPathFailure, env: ProbeEnv): boolean {
  if (env.deployRunning) return false;
  return failure.kind !== "no-answer" || env.linkLive;
}

/** The next record, from the previous one (watched or not) and a probe. */
export function reducePublicPath(
  prev: PublicPath,
  outcome: ProbeOutcome,
  env: ProbeEnv,
  at: number,
): ProbedPublicPath {
  if (outcome.kind === "ok") {
    return prev.kind === "ok" ? prev : { kind: "ok", since: at };
  }
  // The same outage only while probes keep coming: a gap (main stopped,
  // this computer slept) starts a new one.
  const failing =
    prev.kind === "failing" && at - prev.lastAt <= PUBLIC_PATH_GAP_MS
      ? prev
      : null;
  return {
    kind: "failing",
    since: failing?.since ?? at,
    lastAt: at,
    misses: (failing?.misses ?? 0) + (counts(outcome.failure, env) ? 1 : 0),
    failure: outcome.failure,
  };
}

/** Whether the public path is down: failing past its threshold of counted misses. */
export function publicPathDown(path: PublicPath): boolean {
  return path.kind === "failing" && path.misses >= PUBLIC_PATH_DOWN_MISSES;
}

/** The probe that turned the path down — the one moment a report is filed. */
export function turnedDown(prev: PublicPath, next: PublicPath): boolean {
  return publicPathDown(next) && !publicPathDown(prev);
}

/** Whether a record changed enough to write and push (ok → ok is nothing). */
export function publicPathChanged(prev: PublicPath, next: PublicPath): boolean {
  return JSON.stringify(prev) !== JSON.stringify(next);
}
