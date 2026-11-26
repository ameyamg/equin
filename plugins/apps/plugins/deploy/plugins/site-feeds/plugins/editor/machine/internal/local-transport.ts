import {
  deleteSiteFeedEntry,
  missingSiteFeedMedia,
  presentSiteFeedMedia,
  siteFeedOf,
  upsertSiteFeedEntry,
} from "@plugins/apps/plugins/deploy/plugins/site-feeds/plugins/box/server";
import type {
  SiteFeedDecl,
  SiteFeedDeleteAnswer,
  SiteFeedEntryId,
  SiteFeedUpsertAnswer,
  SiteFeedUpsertBody,
} from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import type { PublishTransport } from "./publish-flow";
import { stageAttachment } from "./stage-attachment";

/** The box half this instance runs, as the local transport calls it (injected in tests). */
export interface LocalBox {
  feedOf: (feedId: string) => SiteFeedDecl | null;
  present: (attachmentIds: readonly string[]) => Promise<ReadonlySet<string>>;
  upsert: (
    feed: SiteFeedDecl,
    body: SiteFeedUpsertBody,
  ) => Promise<SiteFeedUpsertAnswer>;
  delete: (
    feed: SiteFeedDecl,
    id: SiteFeedEntryId,
  ) => Promise<SiteFeedDeleteAnswer>;
}

/** This process's own box half: its registry, attachments and tables. */
const THIS_BOX: LocalBox = {
  feedOf: siteFeedOf,
  present: presentSiteFeedMedia,
  upsert: upsertSiteFeedEntry,
  delete: deleteSiteFeedEntry,
};

/**
 * This instance's own copy of the site: the box half runs in this process
 * (the local app runs every plugin, the site's included), so publishing is
 * the box's own upsert / delete called in-process — validated by the same
 * judge, against this release's declaration — and the files are this
 * instance's attachments already: nothing is copied. `missing` still asks
 * the store, so an attachment gone from it fails loudly at staging.
 */
export function localTransport(box: LocalBox = THIS_BOX): PublishTransport {
  const noTransfer = (): never => {
    throw new Error(
      "site-feeds: publishing to this instance transfers no file — the item's media are this instance's attachments",
    );
  };
  return {
    missing: async (attachmentIds) => ({
      kind: "answer",
      value: {
        missing: missingSiteFeedMedia(
          attachmentIds,
          await box.present(attachmentIds),
        ),
      },
    }),
    stage: (ref) => stageAttachment(ref.attachmentId),
    upload: async () => noTransfer(),
    importMedia: async () => noTransfer(),
    upsert: async (body) => {
      const feed = box.feedOf(body.feedId);
      return {
        kind: "answer",
        value:
          feed === null
            ? { kind: "unknown-feed", feedId: body.feedId }
            : await box.upsert(feed, body),
      };
    },
    delete: async (body) => {
      const feed = box.feedOf(body.feedId);
      return {
        kind: "answer",
        value:
          feed === null
            ? { kind: "unknown-feed", feedId: body.feedId }
            : await box.delete(feed, body.id),
      };
    },
  };
}
