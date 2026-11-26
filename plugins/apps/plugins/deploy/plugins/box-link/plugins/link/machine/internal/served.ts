import { db } from "@plugins/database/server";
import { serveValue } from "@plugins/network/plugins/live/machine";
import { refHeadServed } from "@plugins/infra/plugins/git/plugins/git-watcher/server";
import { boxLinks } from "@plugins/apps/plugins/deploy/plugins/box-link/core";
import {
  _deployDeployments,
  _deployRuns,
  deployRunsServed,
  latestDeployRun,
} from "@plugins/apps/plugins/deploy/plugins/deployments/server";
import { readRunningCommit } from "@plugins/apps/plugins/deploy/plugins/remote-deploy/server";
import { siteHealth, type PublicPath, type SiteHealth } from "../../core";
import { currentLinks, isRealBox, linkOf, publicPathOf } from "./store";

/**
 * `deploy.box-links`: the links this instance holds, from memory. The link
 * manager notifies it on every frame that changes a link (a beat included).
 */
export const boxLinksServed = serveValue(boxLinks, {
  source: "external",
  changes: "notified",
  readCost: "memory",
  loader: () => currentLinks(),
});

/**
 * A site's public path: probed only for a real box this instance links that
 * has a public hostname (the probe's own rule, `public-probe.ts`) — its last
 * record, or `pending` before its first probe.
 */
function publicPathFor(
  deploymentId: string,
  hostname: string | null,
): PublicPath {
  if (hostname === null || !isRealBox(deploymentId))
    return { kind: "unwatched" };
  return publicPathOf(deploymentId) ?? { kind: "pending" };
}

async function loadSiteHealth(): Promise<Record<string, SiteHealth>> {
  const rows = await db
    .select({
      id: _deployDeployments.id,
      compositionId: _deployDeployments.compositionId,
      hostnames: _deployDeployments.hostnames,
    })
    .from(_deployDeployments);
  const entries = await Promise.all(
    rows.map(async (r): Promise<[string, SiteHealth]> => {
      const link = linkOf(r.id);
      const run = latestDeployRun(r.id);
      const hostname = r.hostnames[0] ?? null;
      return [
        r.id,
        {
          deploymentId: r.id,
          compositionId: r.compositionId,
          hostname,
          link:
            link === undefined
              ? { kind: "main-only" }
              : { kind: "linked", link },
          run:
            run === undefined
              ? null
              : {
                  id: run.id,
                  verb: run.verb,
                  phase: run.phase,
                  status: run.status,
                  startedAt: run.startedAt,
                  finishedAt: run.finishedAt,
                  message: run.message,
                },
          release: await readRunningCommit(r.id),
          publicPath: publicPathFor(r.id, hostname),
        },
      ];
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * `deploy.site-health`: every deployment's link, newest run and running
 * commit, folded here so the health report reads ONE value. Its changes:
 * a deployment or run row written (`reads`), the live run view moving
 * (`deployRunsServed`), `main` advancing (`refHeadServed`), and a link
 * changing STATE — the link manager's own `notify()`, never a beat — and a
 * probe changing a public path (the probe's own `notify()`).
 */
export const siteHealthServed = serveValue(siteHealth, {
  source: "external",
  changes: "notified",
  reads: {
    tables: [_deployDeployments, _deployRuns],
    reason:
      "every deployment row is an entry, and its running commit is its newest succeeded ship",
  },
  recomputeOn: [deployRunsServed, refHeadServed],
  loader: loadSiteHealth,
});
