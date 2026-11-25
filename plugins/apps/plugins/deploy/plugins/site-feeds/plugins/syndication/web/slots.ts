import { defineSlot } from "@plugins/framework/plugins/web-sdk/core";
import type { SyndicationTargetDecl } from "../core";

/** What a target plugin's web half contributes: its declaration (label, icon, settings fields). */
export interface SyndicationTargetWebContribution {
  readonly target: SyndicationTargetDecl;
}

/**
 * The services a feed's items can be posted to, in the browser — the web twin
 * of the machine's `SyndicationTargets.Target` (same declaration). Read by the
 * Feeds tab's "Also post to" section; data, never drawn.
 */
export const SyndicationTargets = {
  Target: defineSlot<SyndicationTargetWebContribution>({
    docLabel: (c) => c.target.id,
  }),
};
