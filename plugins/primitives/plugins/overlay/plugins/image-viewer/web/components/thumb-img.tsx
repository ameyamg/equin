import { useState } from "react";
import { Center } from "@plugins/primitives/plugins/css/plugins/center/web";
import { Layer } from "@plugins/primitives/plugins/css/plugins/layer/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
import { pickSrc } from "../internal/pick-src";
import { isVideo, type ViewerImage } from "../internal/types";

const playIcon = symbol("play-arrow");

/**
 * A thumbnail's `<img>`: the caller's resized copy when it offers one (at
 * least `edge` device pixels on the long edge), lazily loaded and decoded off
 * the main thread. A copy that fails to load falls back to the original.
 *
 * A video is its first frame (a muted `<video preload="metadata">`, never
 * played) under a play mark. The parent is the positioned box it marks.
 */
export function ThumbImg({
  image,
  edge,
  className,
}: {
  image: ViewerImage;
  edge: number;
  className: string;
}) {
  if (isVideo(image)) return <ThumbVideo image={image} className={className} />;
  return <ThumbStill image={image} edge={edge} className={className} />;
}

function ThumbStill({
  image,
  edge,
  className,
}: {
  image: ViewerImage;
  edge: number;
  className: string;
}) {
  const copy = pickSrc(image, edge, false);
  const [failedCopy, setFailedCopy] = useState<string | null>(null);
  const src = failedCopy === copy ? image.src : copy;
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      loading="lazy"
      decoding="async"
      className={className}
      onError={() => {
        if (src !== image.src) setFailedCopy(copy);
      }}
    />
  );
}

function ThumbVideo({
  image,
  className,
}: {
  image: ViewerImage;
  className: string;
}) {
  return (
    <>
      <video
        src={image.src}
        preload="metadata"
        muted
        playsInline
        aria-hidden
        className={className}
      />
      <Layer decorative>
        <Center axis="both" className="size-full">
          <Icon
            icon={playIcon}
            className="size-5 rounded-full bg-background/70 text-foreground"
          />
        </Center>
      </Layer>
    </>
  );
}
