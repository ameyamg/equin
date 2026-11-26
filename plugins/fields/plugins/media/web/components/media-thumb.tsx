import {
  useState,
  type MouseEventHandler,
  type ReactNode,
  type RefCallback,
} from "react";
import { getAttachmentFile } from "@plugins/infra/plugins/attachments/core";
import { assetPath } from "@plugins/infra/plugins/endpoints/core";
import {
  useAssetSrc,
  useAssetSrcs,
  type AssetSrc,
} from "@plugins/infra/plugins/endpoints/web";
import { Center } from "@plugins/primitives/plugins/css/plugins/center/web";
import { cn } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { rigidClass } from "@plugins/primitives/plugins/css/plugins/rigid/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
import {
  ImageViewer,
  useImageViewerTrigger,
  type ViewerImage,
} from "@plugins/primitives/plugins/overlay/plugins/image-viewer/web";
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

export interface MediaSetThumbProps {
  /** Every file of the set; the first is the one drawn. */
  media: readonly MediaRef[];
  className?: string;
}

/**
 * A set of files drawn as its first one's {@link MediaThumb}: a click opens
 * the image viewer on it, and ← / → step through the set's other images and
 * videos (the ones not drawn fade in, having no thumbnail to grow from). For
 * a compact surface that shows one file for many — a table cell. The click
 * stops at the thumbnail, and so do the viewer's own (it renders in this
 * React tree), so a clickable row around it is not activated. A first file
 * that is not an image or a video stays a plain thumbnail.
 */
export function MediaSetThumb({
  media,
  className,
}: MediaSetThumbProps): ReactNode {
  const [first] = media;
  if (first === undefined) throw new Error("MediaSetThumb: an empty set");
  return <SetThumb first={first} media={media} className={className} />;
}

function isViewable(media: MediaRef): boolean {
  return media.mime.startsWith("image/") || media.mime.startsWith("video/");
}

function SetThumb({
  first,
  media,
  className,
}: MediaSetThumbProps & { first: MediaRef }): ReactNode {
  const src = useMediaSrc(first);
  // The file on screen, by attachment id — the viewer is closed at null.
  const [openId, setOpenId] = useState<string | null>(null);
  const [origin, setOrigin] = useState<HTMLElement | null>(null);
  if (src.kind !== "ready" || !isViewable(first)) {
    return <ThumbBody media={first} className={className} src={src} />;
  }
  return (
    <>
      <ThumbBody
        media={first}
        className={className}
        src={src}
        open={{
          ref: setOrigin,
          onClick: (e) => {
            e.stopPropagation();
            setOpenId(first.attachmentId);
          },
        }}
      />
      {openId !== null ? (
        // The viewer is portaled, but its events still bubble up this React
        // tree — stop them here, before a clickable row.
        <span
          className="contents"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <SetViewer
            media={media.filter(isViewable)}
            openId={openId}
            onOpen={setOpenId}
            onClose={() => setOpenId(null)}
            origin={{ id: first.attachmentId, element: origin }}
          />
        </span>
      ) : null}
    </>
  );
}

/** The viewer over a set's viewable files, mounted only while open — so the
 *  files not drawn are fetched only once someone looks. A file whose bytes
 *  are not here yet joins the set when they are. */
function SetViewer({
  media,
  openId,
  onOpen,
  onClose,
  origin,
}: {
  media: readonly MediaRef[];
  openId: string;
  onOpen: (id: string) => void;
  onClose: () => void;
  origin: { id: string; element: Element | null };
}): ReactNode {
  const srcs = useAssetSrcs(
    media.map((m) => assetPath(getAttachmentFile, { id: m.attachmentId })),
  );
  const ready: { id: string; image: ViewerImage }[] = [];
  media.forEach((m, i) => {
    const s = srcs[i];
    if (s?.kind !== "ready") return;
    ready.push({
      id: m.attachmentId,
      image: {
        kind: m.mime.startsWith("video/") ? "video" : "image",
        src: s.src,
        name: m.filename,
        width: m.width,
        height: m.height,
      },
    });
  });
  const index = ready.findIndex((r) => r.id === openId);
  if (index < 0) return null;
  return (
    <ImageViewer
      images={ready.map((r) => r.image)}
      index={index}
      onIndexChange={(i) => {
        const next = ready[i];
        if (next) onOpen(next.id);
      }}
      onClose={onClose}
      originOf={(i) => (ready[i]?.id === origin.id ? origin.element : null)}
    />
  );
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
