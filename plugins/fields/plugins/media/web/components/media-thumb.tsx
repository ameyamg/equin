import type { MouseEventHandler, ReactNode, RefCallback } from "react";
import { getAttachmentFile } from "@plugins/infra/plugins/attachments/core";
import { assetPath } from "@plugins/infra/plugins/endpoints/core";
import {
  useAssetSrc,
  type AssetSrc,
} from "@plugins/infra/plugins/endpoints/web";
import { Center } from "@plugins/primitives/plugins/css/plugins/center/web";
import { cn } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { rigidClass } from "@plugins/primitives/plugins/css/plugins/rigid/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
import { useImageViewerTrigger } from "@plugins/primitives/plugins/overlay/plugins/image-viewer/web";
import type { MediaRef } from "../../core";

const fileIcon = symbol("draft");
const brokenIcon = symbol("broken-image");

/** What a thumbnail learnt about its file while loading it (pixel size, length). */
export interface MediaMetadata {
  width?: number;
  height?: number;
  durationMs?: number;
}

export interface MediaThumbProps {
  media: MediaRef;
  /** The box: a square of this many CSS pixels' Tailwind size class. */
  className?: string;
  /** Called once the browser has read the file's metadata (image or video). */
  onMetadata?: (meta: MediaMetadata) => void;
}

/**
 * One media ref as a small square: an image as itself, a video as its first
 * frame (a muted `<video preload="metadata">`, never played), anything else
 * as a file glyph. The bytes come over the subtree's transport
 * (`useAssetSrc`); a failed load says so, with the reason on hover.
 */
export function MediaThumb(props: MediaThumbProps): ReactNode {
  const src = useMediaSrc(props.media);
  return <ThumbBody {...props} src={src} />;
}

/**
 * A {@link MediaThumb} that opens its file in the enclosing `<ImageGallery>`'s
 * viewer (← / → through the gallery's other files): an image to zoom, a
 * video to play. A click on it opens it; anything else (a PDF) stays a plain
 * thumbnail. Must render inside an `<ImageGallery>` — it throws outside one.
 */
export function ViewableMediaThumb(props: MediaThumbProps): ReactNode {
  const src = useMediaSrc(props.media);
  const viewable =
    src.kind === "ready" &&
    (props.media.mime.startsWith("image/") ||
      props.media.mime.startsWith("video/"));
  if (!viewable) return <ThumbBody {...props} src={src} />;
  return <ViewerTrigger {...props} src={src} />;
}

function ViewerTrigger({
  src,
  ...props
}: MediaThumbProps & {
  src: Extract<AssetSrc, { kind: "ready" }>;
}): ReactNode {
  const { media } = props;
  const trigger = useImageViewerTrigger<HTMLElement>({
    kind: media.mime.startsWith("video/") ? "video" : "image",
    src: src.src,
    name: media.filename,
    width: media.width,
    height: media.height,
  });
  return (
    <ThumbBody
      {...props}
      src={src}
      open={{ ref: trigger.ref, onClick: trigger.onClick }}
    />
  );
}

function useMediaSrc(media: MediaRef): AssetSrc {
  return useAssetSrc(assetPath(getAttachmentFile, { id: media.attachmentId }));
}

function ThumbBody({
  media,
  className,
  onMetadata,
  src,
  open,
}: MediaThumbProps & {
  src: AssetSrc;
  /** Present: the thumbnail opens the viewer (a zoom-in cursor, a click). */
  open?: {
    ref: RefCallback<HTMLElement>;
    onClick: MouseEventHandler<HTMLElement>;
  };
}): ReactNode {
  const box = cn(
    "size-16 rounded-md border border-border bg-muted",
    rigidClass(),
    className,
    open && "cursor-zoom-in",
  );
  const isImage = media.mime.startsWith("image/");
  const isVideo = media.mime.startsWith("video/");
  if (src.kind === "loading") return <div className={box} />;
  if (src.kind !== "ready") {
    return (
      <Center
        title={src.message}
        aria-label={`${media.filename} failed to load — ${src.message}`}
        className={cn(box, "text-destructive")}
      >
        <Icon icon={brokenIcon} className="size-4" />
      </Center>
    );
  }
  if (isImage) {
    return (
      <img
        src={src.src}
        alt={media.filename}
        title={media.filename}
        decoding="async"
        draggable={false}
        ref={open?.ref}
        onClick={open?.onClick}
        aria-haspopup={open ? "dialog" : undefined}
        className={cn(box, "object-cover")}
        onLoad={(e) =>
          onMetadata?.({
            width: e.currentTarget.naturalWidth,
            height: e.currentTarget.naturalHeight,
          })
        }
      />
    );
  }
  if (isVideo) {
    return (
      <video
        src={src.src}
        title={media.filename}
        aria-label={media.filename}
        preload="metadata"
        ref={open?.ref}
        onClick={open?.onClick}
        aria-haspopup={open ? "dialog" : undefined}
        muted
        playsInline
        className={cn(box, "object-cover")}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          onMetadata?.({
            width: v.videoWidth || undefined,
            height: v.videoHeight || undefined,
            durationMs: Number.isFinite(v.duration)
              ? Math.round(v.duration * 1000)
              : undefined,
          });
        }}
      />
    );
  }
  return (
    <Center title={media.filename} className={cn(box, "text-muted-foreground")}>
      <Icon icon={fileIcon} className="size-5" />
    </Center>
  );
}
