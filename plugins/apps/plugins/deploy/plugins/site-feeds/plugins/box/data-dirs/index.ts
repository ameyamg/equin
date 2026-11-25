import { defineDataDir } from "@plugins/infra/plugins/paths/core";

/**
 * Files a publishing computer copied to the box (scp) and has not yet asked
 * the box to import (`POST /api/host-only/site-feeds/media/import`). The import
 * removes the file it read; what an interrupted publish left behind is swept
 * after a day (`site-feeds.staging-sweep`).
 *
 * `cache`, and genuinely so: a deleted staged file is copied again by the
 * next publish, whose bytes still live on the computer.
 */
export const siteFeedsStagingDir = defineDataDir({
  kind: "cache",
  name: "site-feeds-staging",
  owner: "apps/deploy/site-feeds/box",
  description:
    "Site-feed media files copied to the box and waiting to be imported into its attachments",
  reclaim: { kind: "safe" },
});

export default [siteFeedsStagingDir];
