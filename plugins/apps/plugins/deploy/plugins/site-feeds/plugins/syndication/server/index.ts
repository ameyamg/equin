import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { syndicationsServed } from "./internal/served";

export {
  SyndicationTargets,
  syndicationTarget,
  syndicationTargetOf,
  syndicationTargets,
} from "./internal/targets";
export type {
  SyndicationCallCtx,
  SyndicationTargetCalls,
  SyndicationTargetContribution,
} from "./internal/targets";

export default {
  description:
    "Where a site feed's items are posted besides the site: the SyndicationTargets.Target contribution a target plugin's machine half provides (its declaration and its post / edit / remove calls — nothing here names a target), the site_feed_syndications table (one item on one target: pending, posted with the target's id for it, or failed with why) served live per item, and the per site, feed and target settings table (on or off, the non-secret config).",
  contributions: [...syndicationsServed.declare],
} satisfies ServerPluginDefinition;
