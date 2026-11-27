import { ResourceErrorInline } from "@plugins/network/plugins/live/plugins/live-state/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import {
  WebsiteBand,
  WebsiteChrome,
  WebsiteHero,
} from "@plugins/apps/plugins/website/plugins/shell/web";
import {
  track,
  useReachEvent,
} from "@plugins/apps/plugins/deploy/plugins/analytics/plugins/collect/web";
import {
  siteFeedMediaAsset,
  useSiteFeed,
  type SiteFeedEntry,
} from "@plugins/apps/plugins/deploy/plugins/site-feeds/plugins/box/web";
import { tipsFeed, type TipsFeed } from "../../core";
import { tipsPane } from "../panes";
import { TipCard } from "./tip-card";
import { TipsBulb } from "./tips-bulb";

/** The column the tips read in: the layers' width, centred in the measure. */
const COLUMN = "mx-auto w-full max-w-[53.75rem]";

type TipsFields = TipsFeed["fields"];

/**
 * One tip on the page, measured — its `tip` prop the entry's id: `tip_seen`
 * once per visit to the page when the card reaches the upper half of the
 * screen (read, not scrolled past), `tip_media_open` when one of its
 * screenshots is opened.
 */
function MeasuredTipCard({ entry }: { entry: SiteFeedEntry<TipsFields> }) {
  const seen = useReachEvent<HTMLElement>("tip_seen", { tip: entry.id });
  return (
    <TipCard
      values={entry.values}
      publishedAt={new Date(entry.publishedAt)}
      mediaAsset={(media) => siteFeedMediaAsset(entry.id, media.attachmentId)}
      ref={seen}
      onMediaOpen={() => track("tip_media_open", { tip: entry.id })}
    />
  );
}

/**
 * The tips page's body: the heading, then the published tips, newest first
 * (the box serves them in that order), inside `WebsiteChrome`. Its content is
 * the site's own (`apps/deploy/site-feeds`): written and published from the
 * Deploy app, read live from the box. Loading, a failed read and an empty feed
 * are each said, never an empty list. Its own chunk (`websitePagePart`).
 */
export function TipsBody() {
  const feed = useSiteFeed(tipsFeed);
  return (
    <WebsiteChrome pane={tipsPane}>
      <WebsiteHero
        kind="page"
        icon={<TipsBulb className="website-tips-heading-bulb" />}
        lead="Tips"
        lede="Small things equin can do that you might not have found yet."
      />
      <WebsiteBand section="tips" rhythm="page-body">
        <Stack gap="lg" className={COLUMN}>
          {feed.status === "loading" ? (
            <Loading variant="cards" count={2} />
          ) : feed.status === "error" ? (
            <ResourceErrorInline
              variant="block"
              error={feed.error}
              refetch={feed.refetch}
            />
          ) : feed.data.length === 0 ? (
            <Text as="p" variant="body" tone="muted" className="text-center">
              No tips yet. The first one is on its way.
            </Text>
          ) : (
            feed.data.map((entry) => (
              <MeasuredTipCard key={entry.id} entry={entry} />
            ))
          )}
        </Stack>
      </WebsiteBand>
    </WebsiteChrome>
  );
}
