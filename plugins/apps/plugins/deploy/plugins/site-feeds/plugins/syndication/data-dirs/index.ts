import { defineDataDir } from "@plugins/infra/plugins/paths/core";

/**
 * A syndication run's files: each of the item's media copied out of the
 * attachment store for the target to send (and what it re-encodes to fit),
 * one directory per run, removed once the run ends. What a killed run left
 * is safe to delete: the originals live in the attachment store.
 */
export const syndicationWorkDir = defineDataDir({
  kind: "cache",
  name: "site-feeds-syndication",
  owner: "apps/deploy/site-feeds/syndication",
  description:
    "Site-feed media copied out of the attachment store (and re-encoded) while an item is posted to another service",
  reclaim: { kind: "safe" },
});

export default [syndicationWorkDir];
