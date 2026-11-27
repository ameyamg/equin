import type { ComponentType } from "react";
import { defineSlot } from "@plugins/framework/plugins/web-sdk/core";
import type { MediaRef } from "@plugins/fields/plugins/media/core";
import type { AssetPath } from "@plugins/infra/plugins/endpoints/core";
import type { SiteFeedDecl } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";

/**
 * What a feed's preview is handed: one entry's values (unparsed — the
 * preview reads them through its own declaration), when it was published
 * (null: not yet), and where each of its files is read from.
 */
export interface SiteFeedPreviewProps {
  readonly values: Readonly<Record<string, unknown>>;
  readonly publishedAt: Date | null;
  readonly mediaAsset: (media: MediaRef) => AssetPath;
}

/** What a site plugin contributes: one feed it declares. */
export interface SiteFeedWebContribution {
  readonly feed: SiteFeedDecl;
  /**
   * One entry drawn as the site draws it — what the editor shows when the
   * user reviews a proposed change ("now" beside "after accepting"). Absent:
   * the review shows the changed fields only.
   */
  readonly preview?: ComponentType<SiteFeedPreviewProps>;
}

/**
 * The feeds the code declares, in the browser — the web twin of the box's
 * server registry. A site plugin's `web/` contributes `SiteFeeds.Feed({ feed })`
 * and its `server/` the same declaration; the local editor lists them
 * (`useSiteFeedDeclarations`), each with the plugin that declared it. Data,
 * never drawn by the box itself.
 */
export const SiteFeeds = {
  Feed: defineSlot<SiteFeedWebContribution>({
    docLabel: (c) => c.feed.id,
  }),
};
