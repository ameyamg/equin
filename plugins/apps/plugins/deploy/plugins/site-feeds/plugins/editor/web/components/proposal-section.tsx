import type { ComponentType, ReactNode } from "react";
import { assetPath } from "@plugins/infra/plugins/endpoints/core";
import { getAttachmentFile } from "@plugins/infra/plugins/attachments/core";
import type { MediaRef } from "@plugins/fields/plugins/media/core";
import type { SiteFeedDecl } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import type { SiteFeedPreviewProps } from "@plugins/apps/plugins/deploy/plugins/site-feeds/plugins/box/web";
import type {
  ProposalRow,
  ProposalState,
} from "@plugins/tasks/plugins/proposals/core";
import { ProposalReview } from "@plugins/tasks/plugins/proposals/web";
import type { SiteFeedItemRow } from "../../core";

/** A file of this instance (an item's, or one a proposal brought), for a preview. */
function attachmentAsset(media: MediaRef) {
  return assetPath(getAttachmentFile, { id: media.attachmentId });
}

/**
 * An agent's proposal for one item of a feed (or a new one), reviewed in the
 * Feeds page: the item as the site draws it now beside the item after
 * accepting — the site plugin's own preview (`SiteFeeds.Feed`'s `preview`),
 * reading every file from this instance's attachments.
 */
export function FeedProposalReview({
  proposal,
  feed,
  item,
  preview: Preview,
  onDecided,
}: {
  proposal: ProposalRow;
  feed: SiteFeedDecl;
  /** The item now; null for a proposed new item. */
  item: SiteFeedItemRow | null;
  preview: ComponentType<SiteFeedPreviewProps> | null;
  onDecided?: (state: ProposalState) => void;
}): ReactNode {
  const publishedAt = item?.publishedAt ?? null;
  return (
    <ProposalReview
      // A new revision (or another proposal) starts its own review: the
      // draft of an Edit then accept and a typed note belong to one proposal.
      key={proposal.id}
      proposal={proposal}
      fields={feed.fields}
      current={
        item === null
          ? null
          : { values: item.values, version: item.updatedAt.toISOString() }
      }
      nowLabel={item?.state === "published" ? "On the site now" : "Now"}
      onDecided={onDecided}
      renderPreview={
        Preview === null
          ? null
          : (values) => (
              <Preview
                values={values}
                publishedAt={publishedAt}
                mediaAsset={attachmentAsset}
              />
            )
      }
    />
  );
}
