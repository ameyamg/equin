import type { ComponentType } from "react";
import { defineRenderSlot } from "@plugins/primitives/plugins/slot-render/web";
import type { SiteFeedDecl } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import type { SiteFeedItemRow } from "../core";

/** What a feed card's section is handed: the site and the feed. */
export interface SiteFeedCardProps {
  deploymentId: string;
  feed: SiteFeedDecl;
}

/** What an item's part is handed: the item's live row and its feed. */
export interface SiteFeedItemProps {
  item: SiteFeedItemRow;
  feed: SiteFeedDecl;
}

/**
 * Where what follows a publish (posting it elsewhere — `site-feeds/syndication`)
 * shows itself in the Feeds tab, without the editor naming it:
 *
 * - `FeedSection` — under a feed's items list (per-feed settings);
 * - `ItemStatus` — inline in the item's row, after its state (small chips);
 * - `ItemSection` — in the opened item's editor, under its publish state.
 */
export const SiteFeedEditor = {
  FeedSection: defineRenderSlot<{
    component: ComponentType<SiteFeedCardProps>;
  }>(),
  ItemStatus: defineRenderSlot<{
    component: ComponentType<SiteFeedItemProps>;
  }>(),
  ItemSection: defineRenderSlot<{
    component: ComponentType<SiteFeedItemProps>;
  }>(),
};
