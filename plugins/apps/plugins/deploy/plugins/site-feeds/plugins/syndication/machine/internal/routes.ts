import {
  implementMachine,
  machineHandler,
} from "@plugins/infra/plugins/endpoints/machine";
import {
  retrySyndication,
  saveSyndicationSettings,
  sendTestPost,
} from "../../shared";
import { syndicationTargetOf } from "../../server";
import { feedOfItem } from "@plugins/apps/plugins/deploy/plugins/site-feeds/plugins/editor/server";
import { buildPost, readItem, retryOne, unpostableReason } from "./jobs";
import { loadTargetSettings } from "./settings";
import { makeWorkDir } from "./stage";
import { testPostOnce } from "./test-post";
import { saveTargetSettings } from "./settings";

export const handleSaveSettings = machineHandler(
  saveSyndicationSettings,
  implementMachine(saveSyndicationSettings, async ({ body }) =>
    saveTargetSettings(body),
  ),
);

export const handleRetry = machineHandler(
  retrySyndication,
  implementMachine(retrySyndication, async ({ body }) =>
    retryOne(body.itemId, body.targetId),
  ),
);

/** Send test post: the item to the target with its saved settings, recording nothing. */
export const handleTestPost = machineHandler(
  sendTestPost,
  implementMachine(sendTestPost, async ({ body, req }) => {
    const target = syndicationTargetOf(body.targetId);
    const work = await makeWorkDir();
    try {
      return await testPostOnce(
        {
          target,
          item: async () => {
            const it = await readItem(body.itemId);
            if (it === null) return null;
            if (it.feedId !== body.feedId) {
              return {
                unpostable: `This item belongs to the feed "${it.feedId}", not "${body.feedId}".`,
              };
            }
            return { unpostable: unpostableReason(it) };
          },
          settings: async () =>
            target === null ? null : loadTargetSettings(body.feedId, target),
          stage: async () => {
            const it = await readItem(body.itemId);
            const feed = it === null ? null : feedOfItem(it);
            if (it === null || feed === null) {
              throw new Error(
                `site-feeds: item ${body.itemId} vanished mid-test`,
              );
            }
            return {
              post: await buildPost(it, feed, work.path),
              dispose: async () => undefined,
            };
          },
        },
        body.targetId,
        { signal: req.signal, workDir: work.path },
      );
    } finally {
      await work.dispose();
    }
  }),
);
