import type { MachinePluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { eventField, Trigger } from "@plugins/infra/plugins/events/server";
import {
  siteFeedItemPublished,
  siteFeedItemUnpublished,
} from "@plugins/apps/plugins/deploy/plugins/site-feeds/plugins/editor/server";
import { retrySyndication, saveSyndicationSettings } from "../shared";
import { syndicateItemJob, syndicateJob } from "./internal/jobs";
import { handleRetry, handleSaveSettings } from "./internal/routes";
import { syndicationSettingsServed } from "./internal/settings";

export default {
  description:
    "Posting site feed items elsewhere, on the computer: after each publish and unpublish (siteFeeds.itemPublished / itemUnpublished) site-feeds.syndicate-item queues one site-feeds.syndicate run per target — switched on for the feed, or holding the item's post — which posts the item (its feed's syndicate text and files, copied out of the attachment store), edits the post, or removes it, from where the item stands when it runs; a target's retryable failure is retried, its refusal ends it failed in words. The per site and feed target settings (secret fields in the secrets store, namespace site-feeds), served live with which secrets are set; the save and retry routes.",
  httpRoutes: {
    [saveSyndicationSettings.route]: handleSaveSettings,
    [retrySyndication.route]: handleRetry,
  },
  register: [syndicateJob, syndicateItemJob],
  contributions: [
    ...syndicationSettingsServed.declare,
    Trigger({
      on: siteFeedItemPublished,
      do: syndicateItemJob,
      with: { itemId: eventField("itemId") },
      oneShot: false,
    }),
    Trigger({
      on: siteFeedItemUnpublished,
      do: syndicateItemJob,
      with: { itemId: eventField("itemId") },
      oneShot: false,
    }),
  ],
} satisfies MachinePluginDefinition;
