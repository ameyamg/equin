import { useState } from "react";
import type { MediaRef } from "@plugins/fields/plugins/media/core";
import { useAssetSrc } from "@plugins/infra/plugins/endpoints/web";
import { MediaPlayer } from "@plugins/media/plugins/player/web";
import { ResourceErrorInline } from "@plugins/network/plugins/live/plugins/live-state/web";
import { Card } from "@plugins/primitives/plugins/css/plugins/card/web";
import { Center } from "@plugins/primitives/plugins/css/plugins/center/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import {
  ImageGallery,
  useImageViewerTrigger,
} from "@plugins/primitives/plugins/overlay/plugins/image-viewer/web";
import {
  WebsiteBand,
  WebsiteChrome,
  WebsiteHero,
} from "@plugins/apps/plugins/website/plugins/shell/web";
import {
  siteFeedMediaAsset,
  useSiteFeed,
  type SiteFeedEntry,
} from "@plugins/apps/plugins/deploy/plugins/site-feeds/plugins/box/web";
import { tipsFeed, type TipsFeed } from "../../core";
import { tipsPane } from "../panes";

/** The column the tips read in: the layers' width, centred in the measure. */
const COLUMN = "mx-auto w-full max-w-[53.75rem]";

const CARD_CLASS = "rounded-2xl shadow-none";

/** A media frame: the width of the card, rounded like it. */
const MEDIA_CLASS = "w-full rounded-xl";

const PUBLISHED = new Intl.DateTimeFormat("en-US", { dateStyle: "long" });

type TipsFields = TipsFeed["fields"];

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
        lead="Tips of the "
        accent="day"
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
            feed.data.map((entry) => <TipCard key={entry.id} entry={entry} />)
          )}
        </Stack>
      </WebsiteBand>
    </WebsiteChrome>
  );
}

/**
 * One tip: when it was published, its title, its text, then its media in
 * order. Its screenshots are one gallery: a click opens the full-window
 * viewer, ← / → step through that tip's other screenshots.
 */
function TipCard({ entry }: { entry: SiteFeedEntry<TipsFields> }) {
  const { title, body, media } = entry.values;
  return (
    <Card as="article" className={CARD_CLASS}>
      <Stack gap="lg">
        <Stack gap="sm">
          <Text as="p" variant="caption" tone="muted">
            <time dateTime={entry.publishedAt}>
              {PUBLISHED.format(new Date(entry.publishedAt))}
            </time>
          </Text>
          {title !== "" && (
            <Text as="h2" variant="heading" className="tracking-tight">
              {title}
            </Text>
          )}
          {body !== "" && (
            <Text as="p" variant="body" className="whitespace-pre-line">
              {body}
            </Text>
          )}
        </Stack>
        <ImageGallery>
          {media.map((ref) => (
            <TipMedia key={ref.attachmentId} entryId={entry.id} media={ref} />
          ))}
        </ImageGallery>
      </Stack>
    </Card>
  );
}

/**
 * One screenshot or video of a tip, from the site's public media route. A
 * video plays in the themed player (byte ranges, so it seeks), looping while
 * it is on screen (`autoPlay="in-view"`) and without sound (`silent`: no
 * volume controls), like a GIF; nothing is kept across a reload, so a clip
 * always plays again when read.
 */
function TipMedia({ entryId, media }: { entryId: string; media: MediaRef }) {
  const src = useAssetSrc(siteFeedMediaAsset(entryId, media.attachmentId));
  const [failed, setFailed] = useState<string | null>(null);
  if (src.kind === "loading") {
    return (
      <Loading variant="block" className={`${MEDIA_CLASS} aspect-video`} />
    );
  }
  if (src.kind !== "ready") return <MediaProblem message={src.message} />;
  if (failed !== null) return <MediaProblem message={failed} />;
  if (media.mime.startsWith("video/")) {
    return (
      <MediaPlayer
        kind="video"
        src={src.src}
        label={media.filename}
        autoPlay="in-view"
        silent
        keep={null}
        onError={(error) =>
          setFailed(
            `The video could not be played${error?.message ? `: ${error.message}` : "."}`,
          )
        }
        className={`${MEDIA_CLASS} aspect-video`}
      />
    );
  }
  return <TipImage src={src.src} media={media} />;
}

/**
 * A screenshot at the card's width; a click (or Enter) opens it in the
 * enclosing tip's image viewer, which grows out of this box.
 */
function TipImage({ src, media }: { src: string; media: MediaRef }) {
  const trigger = useImageViewerTrigger<HTMLButtonElement>({
    src,
    name: media.filename,
    width: media.width,
    height: media.height,
  });
  return (
    <button
      type="button"
      aria-label={`Open ${media.filename}`}
      className={`${MEDIA_CLASS} focus-ring block cursor-zoom-in`}
      {...trigger}
    >
      <img
        src={src}
        alt={media.filename}
        width={media.width}
        height={media.height}
        loading="lazy"
        decoding="async"
        className={`${MEDIA_CLASS} block h-auto border border-border`}
      />
    </button>
  );
}

/** What stands in a file's place when it cannot be shown, saying why. */
function MediaProblem({ message }: { message: string }) {
  return (
    <Center className={`${MEDIA_CLASS} aspect-video border border-border`}>
      <Text tone="muted">{message}</Text>
    </Center>
  );
}
