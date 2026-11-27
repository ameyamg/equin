// A rendered body's inline images (`cid:` parts), resolved over the reader's
// own transport. The server writes each as a token (`inlineImageToken`),
// never a route: the body is framed at an opaque origin, which loads by URL —
// and a route string would load from the PAGE's server, which an in-browser
// host (the website's demo) is not. So the page decides:
//
// - a transport a URL reaches (the page's own server): the inline-part
//   route's URL, which the frame's policy admits;
// - a transport no URL reaches (an in-browser server): the parts as `data:`
//   URLs, read live (`mailInlineImages`) — the frame cannot load the page's
//   blob URLs (its origin is opaque), and its policy then admits `data:`
//   images only, so nothing in the body reaches the page's server.
import { assetPath } from "@plugins/infra/plugins/endpoints/core";
import { assetUrlOver } from "@plugins/infra/plugins/endpoints/web";
import { useLive } from "@plugins/network/plugins/live/web";
import { useTransport } from "@plugins/primitives/plugins/networking/web";
import {
  inlineImageToken,
  mailInlineImages,
  mailInlinePart,
  type ReaderInlineImage,
} from "../../core";

/** Each inline image's `src` by token index, or the reason they are not drawn. */
export type InlineImageSrcs =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly srcs: readonly string[] }
  | { readonly kind: "error"; readonly message: string };

const LOADING: InlineImageSrcs = Object.freeze({ kind: "loading" });
const NONE: InlineImageSrcs = Object.freeze({ kind: "ready", srcs: [] });

/**
 * The `src` of each of a message's inline images over the subtree's
 * transport: the route's URL where a URL reaches the server (at once), else
 * the parts as `data:` URLs (loading until read).
 */
export function useInlineImageSrcs(
  threadId: string,
  messageId: string,
  images: readonly ReaderInlineImage[],
): InlineImageSrcs {
  const transport = useTransport();
  const byUrl = transport.servesUrls;
  const read = useLive(
    mailInlineImages,
    byUrl || images.length === 0 ? null : { threadId, messageId },
  );
  if (images.length === 0) return NONE;
  if (byUrl) {
    return {
      kind: "ready",
      srcs: images.map((img) => {
        const url = assetUrlOver(
          transport,
          assetPath(
            mailInlinePart,
            { sig: img.sig },
            { t: threadId, m: messageId, p: img.partId },
          ),
        );
        // The inline-part route is portable, and a URL reaches it here.
        if (url.kind !== "ready") {
          throw new Error(`inline image ${img.partId}: ${url.kind}`);
        }
        return url.url;
      }),
    };
  }
  if (read.status === "loading") return LOADING;
  if (read.status === "error") {
    return { kind: "error", message: read.error.message };
  }
  return { kind: "ready", srcs: read.data.srcs };
}

/** `html` with each inline image's token replaced by its `src` (an unresolved one by nothing). */
export function withInlineImages(
  html: string,
  srcs: readonly string[] | null,
  count: number,
): string {
  let out = html;
  // Highest index first, so `mail-inline:1` never eats into `mail-inline:10`.
  for (let i = count - 1; i >= 0; i--) {
    out = out.split(inlineImageToken(i)).join(srcs?.[i] ?? "");
  }
  return out;
}
