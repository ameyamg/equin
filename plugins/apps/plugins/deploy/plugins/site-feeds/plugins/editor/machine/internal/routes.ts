import { eq } from "drizzle-orm";
import { db } from "@plugins/database/server";
import {
  implementMachine,
  machineHandler,
} from "@plugins/infra/plugins/endpoints/machine";
import {
  publishSiteFeedItem,
  unpublishSiteFeedItem,
  updateSiteFeedItem,
} from "../../shared";
import { siteFeedDestinations, siteFeedItemUnpublished } from "../../server";
import { _siteFeedItems } from "../../server/internal/tables";
import { requireItem, saveItemValues } from "../../server/internal/items-repo";
import { publishTargets } from "./fan-out";
import { queuePublication, requeueHeld } from "./jobs";

/**
 * Autosave: the fields one edit changed, merged onto the stored values. A
 * published item is published again wherever it has a copy — each keyed job
 * folds a burst of edits into the run still pending.
 */
export const handleUpdateItem = machineHandler(
  updateSiteFeedItem,
  implementMachine(updateSiteFeedItem, async ({ params, body }) => {
    const { answer, item } = await saveItemValues(params.id, body.set);
    if (answer.kind === "saved" && item.state === "published") {
      await requeueHeld(item.id, "publishing");
    }
    return answer;
  }),
);

export const handlePublishItem = machineHandler(
  publishSiteFeedItem,
  implementMachine(publishSiteFeedItem, async ({ params, body }) => {
    const item = await requireItem(params.id);
    const destinations = await siteFeedDestinations(item.feedId);
    if (destinations === null) {
      return { kind: "unknown-feed", feedId: item.feedId };
    }
    const targets = publishTargets(destinations, body.destination);
    if (targets.kind === "refused") return targets;
    // The intent first: every run reads it.
    await db
      .update(_siteFeedItems)
      .set({ state: "published", publishedAt: item.publishedAt ?? new Date() })
      .where(eq(_siteFeedItems.id, item.id));
    for (const d of targets.destinations) {
      await queuePublication(item.id, d, "publishing");
    }
    return { kind: "queued", destinations: targets.destinations };
  }),
);

export const handleUnpublishItem = machineHandler(
  unpublishSiteFeedItem,
  implementMachine(unpublishSiteFeedItem, async ({ params }) => {
    const item = await requireItem(params.id);
    await db
      .update(_siteFeedItems)
      .set({ state: "draft", publishedAt: null })
      .where(eq(_siteFeedItems.id, item.id));
    const destinations = await requeueHeld(item.id, "unpublishing");
    // No copy held it: it is off every one already — say so now, since no
    // run will (syndication removes the posts it made of it).
    if (destinations.length === 0) {
      await siteFeedItemUnpublished.emit({
        itemId: item.id,
        feedId: item.feedId,
      });
    }
    return { kind: "queued", destinations };
  }),
);
