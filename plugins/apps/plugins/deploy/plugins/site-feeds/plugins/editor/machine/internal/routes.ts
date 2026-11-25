import {
  implementMachine,
  machineHandler,
} from "@plugins/infra/plugins/endpoints/machine";
import {
  publishSiteFeedItem,
  unpublishSiteFeedItem,
  updateSiteFeedItem,
} from "../../shared";
import {
  claimPublishState,
  requireItem,
  saveItemValues,
} from "../../server/internal/items-repo";
import { siteFeedPublishJob, siteFeedUnpublishJob } from "./jobs";

/**
 * Autosave: the fields one edit changed, merged onto the stored values. A published item (or one on its way)
 * is published again — the keyed job folds a burst of edits into the run
 * still pending.
 */
export const handleUpdateItem = machineHandler(
  updateSiteFeedItem,
  implementMachine(updateSiteFeedItem, async ({ params, body }) => {
    const { answer, item } = await saveItemValues(params.id, body.set);
    if (
      answer.kind === "saved" &&
      (item.state === "published" || item.publishState === "publishing") &&
      (await claimPublishState(item.id, "publishing"))
    ) {
      await siteFeedPublishJob.enqueue({ itemId: item.id });
    }
    return answer;
  }),
);

export const handlePublishItem = machineHandler(
  publishSiteFeedItem,
  implementMachine(publishSiteFeedItem, async ({ params }) => {
    const item = await requireItem(params.id);
    if (!(await claimPublishState(item.id, "publishing")))
      return { kind: "busy" };
    await siteFeedPublishJob.enqueue({ itemId: item.id });
    return { kind: "queued" };
  }),
);

export const handleUnpublishItem = machineHandler(
  unpublishSiteFeedItem,
  implementMachine(unpublishSiteFeedItem, async ({ params }) => {
    const item = await requireItem(params.id);
    if (!(await claimPublishState(item.id, "unpublishing")))
      return { kind: "busy" };
    await siteFeedUnpublishJob.enqueue({ itemId: item.id });
    return { kind: "queued" };
  }),
);
