import { defineDataDir } from "@plugins/infra/plugins/paths/core";

/**
 * A feed item's media file on its way to a site's box: copied out of the
 * attachment store (hashed on the way) for `scp`, removed once the transfer
 * ends. What a killed publish left is safe to delete: the bytes live in the
 * attachment store.
 */
export const siteFeedsOutgoingDir = defineDataDir({
  kind: "cache",
  name: "site-feeds-outgoing",
  owner: "apps/deploy/site-feeds/editor",
  description:
    "Site-feed media files copied out of the attachment store while they are sent to a site's box",
  reclaim: { kind: "safe" },
});

export default [siteFeedsOutgoingDir];
