import { useState, type Ref } from "react";
import type { MediaRef } from "@plugins/fields/plugins/media/core";
import { FormattedTextView } from "@plugins/fields/plugins/formatted-text/web";
import { useAssetSrc } from "@plugins/infra/plugins/endpoints/web";
import { MediaPlayer } from "@plugins/media/plugins/player/web";
import { Card } from "@plugins/primitives/plugins/css/plugins/card/web";
import { Center } from "@plugins/primitives/plugins/css/plugins/center/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import { useDateFormatter } from "@plugins/fields/plugins/date/plugins/format/web";
import {
  ImageGallery,
  useImageViewerTrigger,
} from "@plugins/primitives/plugins/overlay/plugins/image-viewer/web";
import type { AssetPath } from "@plugins/infra/plugins/endpoints/core";
import type { SiteFeedValues } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import type { SiteFeedPreviewProps } from "@plugins/apps/plugins/deploy/plugins/site-feeds/plugins/box/web";
import { tipsFeed, type TipsFeed } from "../../core";

const CARD_CLASS = "rounded-2xl shadow-none";

/** A media frame: the width of the card, rounded like it. */
const MEDIA_CLASS = "w-full rounded-xl";

type TipsFields = TipsFeed["fields"];

/**
 * One tip as the tips page draws it: when it was published, its title, its
 * text (formatted: bold, key caps, links, line breaks — `fields/formatted-text`),
 * then its media in order. Its screenshots are one gallery: a click opens the
 * full-window viewer, ← / → step through that tip's other screenshots.
 *
 * Presentation only, over plain values, so any surface showing a tip as it
 * will read (a proposed edit's before/after, `TipPreview`) draws this same
 * card: `publishedAt` null reads "Not published yet", `mediaAsset` says where
 * each file is read from (the box's public media route on the site, the
 * attachment route in the editor), `ref` lands on the card's `<article>`,
 * `onMediaOpen` runs when one of its screenshots is opened.
 */
export function TipCard({
  values,
  publishedAt,
  mediaAsset,
  ref,
  onMediaOpen,
}: {
  values: SiteFeedValues<TipsFields>;
  publishedAt: Date | null;
  mediaAsset: (media: MediaRef) => AssetPath;
  ref?: Ref<HTMLElement>;
  onMediaOpen?: () => void;
}) {
  const { title, body, media } = values;
  const fmt = useDateFormatter();
  return (
    <Card as="article" ref={ref} className={CARD_CLASS}>
      <Stack gap="lg">
        <Stack gap="sm">
          <Text as="p" variant="caption" tone="muted">
            {publishedAt === null ? (
              "Not published yet"
            ) : (
              <time dateTime={publishedAt.toISOString()}>
                {fmt.date(publishedAt, { month: "long", year: "always" })}
              </time>
            )}
          </Text>
          {title !== "" && (
            <Text as="h2" variant="heading" className="tracking-tight">
              {title}
            </Text>
          )}
          {body !== "" && (
            <Text as="p" variant="body">
              <FormattedTextView source={body} />
            </Text>
          )}
        </Stack>
        <ImageGallery>
          {media.map((ref) => (
            <TipMedia
              key={ref.attachmentId}
              asset={mediaAsset(ref)}
              media={ref}
              onOpen={onMediaOpen}
            />
          ))}
        </ImageGallery>
      </Stack>
    </Card>
  );
}

/**
 * A tip's values as the site would draw them, for the editor's review of a
 * proposal (`SiteFeeds.Feed`'s `preview`, loaded lazily). Values that no
 * longer fit the feed are said, never drawn half.
 */
export function TipPreview({
  values,
  publishedAt,
  mediaAsset,
}: SiteFeedPreviewProps) {
  const parsed = tipsFeed.valuesSchema.safeParse(values);
  if (!parsed.success) {
    return (
      <Text tone="destructive">
        This tip does not fit the feed&apos;s fields: {parsed.error.message}
      </Text>
    );
  }
  return (
    <TipCard
      values={parsed.data}
      publishedAt={publishedAt}
      mediaAsset={mediaAsset}
    />
  );
}

/**
 * One screenshot or video of a tip, from where `asset` says. A
 * video plays in the themed player (byte ranges, so it seeks), looping while
 * it is on screen (`autoPlay="in-view"`) and without sound (`silent`: no
 * volume controls), like a GIF; nothing is kept across a reload, so a clip
 * always plays again when read.
 */
function TipMedia({
  asset,
  media,
  onOpen,
}: {
  asset: AssetPath;
  media: MediaRef;
  onOpen: (() => void) | undefined;
}) {
  const src = useAssetSrc(asset);
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
  return <TipImage src={src.src} media={media} onOpen={onOpen} />;
}

/**
 * A screenshot at the card's width; a click (or Enter) opens it in the
 * enclosing tip's image viewer, which grows out of this box.
 */
function TipImage({
  src,
  media,
  onOpen,
}: {
  src: string;
  media: MediaRef;
  onOpen: (() => void) | undefined;
}) {
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
      onClick={(event) => {
        trigger.onClick(event);
        onOpen?.();
      }}
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
