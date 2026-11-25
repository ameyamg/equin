import type { ReactNode } from "react";
import { getAttachmentFile } from "@plugins/infra/plugins/attachments/core";
import { assetPath } from "@plugins/infra/plugins/endpoints/core";
import { useAssetSrc } from "@plugins/infra/plugins/endpoints/web";
import { Center } from "@plugins/primitives/plugins/css/plugins/center/web";
import { cn } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { rigidClass } from "@plugins/primitives/plugins/css/plugins/rigid/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
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
export function MediaThumb({
  media,
  className,
  onMetadata,
}: MediaThumbProps): ReactNode {
  const src = useAssetSrc(
    assetPath(getAttachmentFile, { id: media.attachmentId }),
  );
  const box = cn(
    "size-16 rounded-md border border-border bg-muted",
    rigidClass(),
    className,
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
