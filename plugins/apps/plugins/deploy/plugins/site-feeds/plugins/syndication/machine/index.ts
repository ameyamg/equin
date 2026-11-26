import type { MachinePluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { eventField, Trigger } from "@plugins/infra/plugins/events/server";
import {
  siteFeedItemPublished,
  siteFeedItemUnpublished,
} from "@plugins/apps/plugins/deploy/plugins/site-feeds/plugins/editor/server";
import {
  retrySyndication,
  saveSyndicationSettings,
  sendTestPost,
} from "../shared";
import { syndicateItemJob, syndicateJob } from "./internal/jobs";
import {
  handleRetry,
  handleSaveSettings,
  handleTestPost,
} from "./internal/routes";
import { syndicationSettingsServed } from "./internal/settings";

export default {
  description:
    "Posting site feed items elsewhere, on the computer: after each publish and unpublish (siteFeeds.itemPublished / itemUnpublished) site-feeds.syndicate-item queues one site-feeds.syndicate run per target — switched on for the feed, or holding the item's post — which posts the item (its feed's syndicate text and files, copied out of the attachment store), edits the post, or removes it, from where the item stands when it runs; a target's retryable failure is retried, its refusal ends it failed in words. Runs once per item, never once per copy of the site: the editor emits its events when the item's primary destination has it. The per feed target settings (secret fields in the secrets store, namespace site-feeds), served live with which secrets are set; the save and retry routes, and Send test post (the open item posted to one target with its saved settings, on or off, recording nothing, answering the target's words and the post's link).",
  httpRoutes: {
    [saveSyndicationSettings.route]: handleSaveSettings,
    [retrySyndication.route]: handleRetry,
    [sendTestPost.route]: handleTestPost,
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
