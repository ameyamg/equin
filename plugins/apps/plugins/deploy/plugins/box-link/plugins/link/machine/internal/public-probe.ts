import { z } from "zod";
import { db } from "@plugins/database/server";
import { defineJob } from "@plugins/infra/plugins/jobs/server";
import { recordReport } from "@plugins/reports/plugins/engine/server";
import { awakeTimeoutSignal } from "@plugins/packages/plugins/deadline/core";
import {
  _deployDeployments,
  latestDeployRun,
} from "@plugins/apps/plugins/deploy/plugins/deployments/server";
import { writePublicPath } from "@plugins/apps/plugins/deploy/plugins/box-link/plugins/link/server";
import { PUBLIC_PATH_PROBE_PATH, type PublicPath } from "../../core";
import {
  classifyProbe,
  publicPathChanged,
  reducePublicPath,
  turnedDown,
  type ProbeAnswer,
} from "../../shared/public-probe";
import {
  describePublicPathReport,
  type PublicPathReport,
} from "../../shared/public-path-report";
import {
  linkOf,
  publicPathOf,
  realBoxDeploymentIds,
  setPublicPath,
} from "./store";
import { siteHealthServed } from "./served";

// The public-path probe: once a minute, GET each real site's public URL the
// way visitors reach it (Cloudflare → Caddy → gateway → app), so an outage
// the SSH link cannot see — a 522 while SSH works — reaches the Deployed
// sites row and, sustained, a report. Polling is the documented exception: a
// site that does not answer sends no change signal. Known limit: it runs on
// this computer, so it watches only while the computer is awake and main runs.

/**
 * The probe's bound — around a network peer. Cloudflare's own 522 comes back
 * after its ~15–19 s origin connect timeout, so 30 s lets it arrive; past
 * that, no answer is the verdict.
 */
const PROBE_BOUND_MS = 30_000;

/**
 * Not a visitor: the request runs no JS, so the site's analytics (the
 * tracker's beacons) and visitor reports never see it; named so the box's
 * and Cloudflare's logs can tell it apart.
 */
const PROBE_USER_AGENT = "equin-public-path-probe/1";

/** One GET of the public health check, as what answered (or that nothing did). */
export async function probePublicUrl(url: string): Promise<ProbeAnswer> {
  try {
    // The body is read inside the bound too: headers sent, then a stalled or
    // reset body, is no answer as much as a refused connection.
    const res = await fetch(url, {
      signal: awakeTimeoutSignal(PROBE_BOUND_MS),
      redirect: "manual",
      headers: { "user-agent": PROBE_USER_AGENT, "cache-control": "no-cache" },
    });
    return {
      kind: "answered",
      status: res.status,
      via: res.headers.get("via"),
      body: await res.text(),
    };
  } catch (err) {
    // Every way a request gets no whole HTTP answer (DNS, TLS, connect,
    // reset, the bound) is the verdict here, not a bug of this code.
    return {
      kind: "no-answer",
      error:
        err instanceof DOMException && err.name === "TimeoutError"
          ? `no answer in ${String(PROBE_BOUND_MS / 1000)} s`
          : err instanceof Error
            ? err.message
            : String(err),
    };
  }
}

async function probeOne(
  deploymentId: string,
  hostname: string,
): Promise<boolean> {
  // A deploy running at either end of the probe explains its failure.
  const deployingBefore = deployRunning(deploymentId);
  const answer = await probePublicUrl(
    `https://${hostname}${PUBLIC_PATH_PROBE_PATH}`,
  );
  const at = Date.now();
  const prev: PublicPath = publicPathOf(deploymentId) ?? { kind: "pending" };
  const link = linkOf(deploymentId);
  const next = reducePublicPath(
    prev,
    classifyProbe(answer),
    {
      linkLive: link?.state.kind === "live",
      deployRunning: deployingBefore || deployRunning(deploymentId),
    },
    at,
  );
  if (!publicPathChanged(prev, next)) return false;
  // Report, then write, then remember: a report or a write that throws
  // leaves the record as it was, so the next probe crosses the threshold
  // again and retries the report — never an outage remembered as reported.
  if (turnedDown(prev, next) && next.kind === "failing") {
    const data: PublicPathReport = {
      deploymentId,
      hostname,
      since: next.since,
      misses: next.misses,
      failure: next.failure,
      linkState: link?.state.kind ?? "connecting",
    };
    await recordReport({
      kind: "site-public-path",
      source: "server-site-probe",
      data,
      message: describePublicPathReport(data),
      url: `https://${hostname}${PUBLIC_PATH_PROBE_PATH}`,
    });
  }
  await writePublicPath(deploymentId, next);
  setPublicPath(deploymentId, next);
  return true;
}

function deployRunning(deploymentId: string): boolean {
  return latestDeployRun(deploymentId)?.status === "running";
}

export const publicPathProbeJob = defineJob({
  name: "deploy.box-link.public-probe",
  description:
    "Probes each deployed site's public URL through Cloudflare (GET /api/health) once a minute, records where the public path broke, and files a site-public-path report once it has failed three minutes running.",
  // seconds: one small GET per real deployment (a handful), in parallel,
  // each bounded by PROBE_BOUND_MS, plus at most one row write each.
  hold: "seconds",
  input: z.object({}),
  event: z.never(),
  dedup: "singleton",
  // Every minute; perWorktree unset ⇒ main only — and only main links real
  // boxes (`realBoxDeploymentIds` is empty anywhere else).
  schedule: { cron: "* * * * *" },
  // The next tick is the retry.
  maxAttempts: 1,
  run: async () => {
    const ids = new Set<string>(realBoxDeploymentIds());
    if (ids.size === 0) return;
    // Every deployment row (a handful), kept to the real boxes linked here.
    const rows = await db
      .select({
        id: _deployDeployments.id,
        hostnames: _deployDeployments.hostnames,
      })
      .from(_deployDeployments);
    // Each site on its own: one site's failure (a write, a report) neither
    // hides the others' changes nor skips the push; it is rethrown after.
    const results = await Promise.allSettled(
      rows.flatMap((r) => {
        if (!ids.has(r.id)) return [];
        const hostname = r.hostnames[0];
        return hostname === undefined ? [] : [probeOne(r.id, hostname)];
      }),
    );
    if (results.some((r) => r.status === "fulfilled" && r.value))
      siteHealthServed.notify();
    const failed = results.flatMap((r) =>
      r.status === "rejected" ? [r.reason] : [],
    );
    if (failed.length > 0)
      throw new AggregateError(
        failed,
        "public-path probe: a site's record failed",
      );
  },
});
