import { SOURCE_REPO } from "@plugins/framework/plugins/product-name/core";
import {
  _githubReleases,
  _githubRuns,
} from "@plugins/integrations/plugins/github-events/server";
import {
  forwarderStatusOf,
  githubEventsStatusServed,
  newestRunOf,
  releaseOf,
} from "@plugins/integrations/plugins/github-events/machine";
import { RELEASE_WORKFLOW } from "@plugins/installer/plugins/release-assets/core";
import { serveValue } from "@plugins/network/plugins/live/machine";
import {
  upstreamPublication,
  type GitHubPublication,
} from "@plugins/upstream/plugins/release/core";

/**
 * What GitHub published of one release tag: the release workflow's newest run
 * of it and its Release, as the product repo's forwarder stored them. Claims
 * nothing while that forwarder is not connected — what was stored may be
 * stale. Recomputed on what GitHub tells: a run or release stored, a
 * forwarder's state changing. Memory and two indexed reads, no git — so the
 * many no-op signals (another watched repo's forwarder or run) cost
 * milliseconds, never the publisher status's git reads.
 */
export const publicationServed = serveValue(upstreamPublication, {
  source: "external",
  changes: "notified",
  reads: {
    tables: [_githubRuns, _githubReleases],
    reason:
      "a run or release GitHub reported changes what it published of the tag",
  },
  recomputeOn: [githubEventsStatusServed],
  loader: ({ tag }) => readGitHubPublication(tag),
});

async function readGitHubPublication(tag: string): Promise<GitHubPublication> {
  const forwarder = forwarderStatusOf(SOURCE_REPO);
  if (forwarder === null) return { kind: "not-connected", state: "not-set-up" };
  if (forwarder.state !== "connected")
    return { kind: "not-connected", state: forwarder.state };
  const [run, release] = await Promise.all([
    newestRunOf({
      repo: SOURCE_REPO,
      workflowPath: RELEASE_WORKFLOW,
      head: tag,
    }),
    releaseOf(SOURCE_REPO, tag),
  ]);
  return {
    kind: "connected",
    run:
      run === null
        ? null
        : { status: run.status, conclusion: run.conclusion, url: run.url },
    release:
      release === null
        ? null
        : { draft: release.draft, assets: release.assets, url: release.url },
  };
}
