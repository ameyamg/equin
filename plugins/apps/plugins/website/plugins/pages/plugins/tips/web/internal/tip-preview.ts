import { lazyComponent } from "@plugins/primitives/plugins/lazy-component/web";
import type { SiteFeedPreviewProps } from "@plugins/apps/plugins/deploy/plugins/site-feeds/plugins/box/web";

/**
 * A tip as the page draws it, for the editor's review of a proposed change —
 * the page body's own chunk, loaded on the first review, never at boot.
 */
export const TipPreview = lazyComponent<SiteFeedPreviewProps>(() =>
  import("../components/tip-card").then((m) => ({ default: m.TipPreview })),
);
