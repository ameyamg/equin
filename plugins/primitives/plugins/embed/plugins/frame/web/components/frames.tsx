import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import {
  contentUrlOver,
  useAssetSrc,
  type AssetSrc,
  type ContentUrl,
  type ReadyContentUrl,
} from "@plugins/infra/plugins/endpoints/web";
import type {
  AssetPath,
  ContentPath,
} from "@plugins/infra/plugins/endpoints/core";
import { useTransport } from "@plugins/primitives/plugins/networking/web";
import { usePagePort } from "@plugins/infra/plugins/launcher/plugins/gateway-port/web";
import {
  namespaceUrl,
  type Namespace,
} from "@plugins/infra/plugins/namespace/core";
import {
  classifyFrameUrl,
  fitDocument,
  mintNonce,
  reportedHeight,
} from "../../core";
import { connectFrame, type FrameChannel } from "../internal/channel";

// THE ONE FILE that renders an <iframe>. Every frame in the app is one of the
// components below, and the `frame/no-raw-frame` lint rejects an <iframe> (or
// <frame>, <object>, <embed>) anywhere else. `allow-same-origin` is spelled
// here alone, and only for a URL this file built or classified itself: the
// content host (`ContentFrame`) or another site (`ForeignFrame`) — never an
// app origin. Trust boundaries, Phase 3: research/2026-10-29-global-content-isolation.md.

/** The layout props every frame passes through to its <iframe>. */
interface FrameBoxProps {
  title: string;
  className?: string;
  style?: CSSProperties;
  width?: number;
  height?: number;
  loading?: "lazy" | "eager";
  "aria-hidden"?: boolean;
  tabIndex?: number;
  ref?: Ref<HTMLIFrameElement>;
}

/**
 * The event a {@link ContentFrame}'s element fires (bubbling) when the reader
 * moves, presses, scrolls or types inside it — pointer and key events inside
 * a frame never reach its parent document.
 */
export const FRAME_ACTIVITY_EVENT = "equin-frame-activity";

/** The sandbox a content document runs in: its own origin, never `top`'s. */
const CONTENT_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-modals";

/**
 * {@link ContentUrl} of `content` over the subtree's transport — the URL a
 * {@link ContentFrame} takes (`ready`), or why it cannot show here.
 */
export function useContentUrl(content: ContentPath): ContentUrl {
  return contentUrlOver(useTransport(), content);
}

/**
 * Untrusted CONTENT — a document an `access: { content }` route serves (an
 * agent-written prototype) — on the content host (`<item>.content.localhost`),
 * one origin per piece of content, never the app's: it can reach neither the
 * app's APIs as the owner nor `top`. `src` comes only from `useContentUrl` /
 * `contentUrlOver` (a {@link ReadyContentUrl}). The parent talks to it over
 * `onChannel` — the frame agent's channel, a new one per loaded document,
 * closed when the next document loads or the frame unmounts — and hears the
 * reader's activity inside it as {@link FRAME_ACTIVITY_EVENT}.
 */
export function ContentFrame({
  src,
  onChannel,
  onLoad,
  ...box
}: FrameBoxProps & {
  src: ReadyContentUrl;
  /** The loaded document's channel. */
  onChannel?: (channel: FrameChannel, frame: HTMLIFrameElement) => void;
  onLoad?: (frame: HTMLIFrameElement) => void;
}) {
  const channel = useRef<FrameChannel | null>(null);
  useEffect(() => () => channel.current?.close(), []);
  return (
    <iframe
      {...box}
      src={src.url}
      sandbox={CONTENT_SANDBOX}
      onLoad={(e) => {
        const frame = e.currentTarget;
        channel.current?.close();
        const ch = connectFrame(frame, src.url);
        channel.current = ch;
        // Input inside the frame never reaches this document: re-announced
        // on the frame element, bubbling, for whoever watches for activity.
        ch.onActivity(() =>
          frame.dispatchEvent(
            new Event(FRAME_ACTIVITY_EVENT, { bubbles: true }),
          ),
        );
        onChannel?.(ch, frame);
        onLoad?.(frame);
      }}
    />
  );
}

/**
 * A page of ANOTHER SITE someone pasted (a video, a map): framed as that
 * site, on its own origin — which is why it may keep `allow-same-origin` (its
 * player needs its own storage). A URL that is not another site — an equin
 * page, the content host, this computer, a non-web scheme — is never framed:
 * `refused(reason)` renders instead (`classifyFrameUrl`).
 */
export function ForeignFrame({
  url,
  allow,
  allowFullScreen,
  refused,
  ...box
}: FrameBoxProps & {
  url: string;
  /** The Permissions Policy (`allow`) the embedded player asks for. */
  allow?: string;
  allowFullScreen?: boolean;
  refused: (reason: string) => ReactNode;
}) {
  const verdict = classifyFrameUrl(url);
  if (verdict.kind === "refused") return refused(verdict.reason);
  return (
    <iframe
      {...box}
      src={verdict.url}
      allow={allow}
      allowFullScreen={allowFullScreen}
      sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
    />
  );
}

/** What an {@link InlineFrame}'s document may do — never `allow-same-origin`. */
export type InlineFrameAllowance =
  "scripts" | "popups" | "popups-to-escape-sandbox" | "forms" | "modals";

/**
 * An HTML STRING (a host file previewed, a mail body) in an opaque origin: a
 * `srcdoc` sandbox WITHOUT `allow-same-origin`, so whatever it runs can
 * neither read nor reach the app. Scripts and the rest only as `allow` grants
 * them.
 *
 * `fit`: the frame is as tall as its document (it never scrolls itself — the
 * page around it does), for a document laid out in the page's flow (a mail
 * message among others). Its height comes from a reporter script admitted by
 * a per-document nonce (`fitDocument`): the markup's own scripts stay
 * blocked, so `fit` never takes the `scripts` allowance (tsc). The caller's
 * box gives the width; its height is the document's root, so the document
 * must not size its root by the viewport (`height:100%`, `100vh`). A frame
 * that navigates away from its document is given it back (re-mounted): no
 * page but the caller's runs with the reporter's script allowance.
 */
export function InlineFrame(
  props: FrameBoxProps &
    (
      | { html: string; allow?: readonly InlineFrameAllowance[]; fit?: false }
      | {
          html: string;
          allow?: readonly Exclude<InlineFrameAllowance, "scripts">[];
          fit: true;
        }
    ),
) {
  if (props.fit === true) return <FittedInlineFrame {...props} />;
  const { html, allow = [], fit: _fit, ...box } = props;
  return (
    <iframe
      {...box}
      srcDoc={html}
      sandbox={allow.map((a) => `allow-${a}`).join(" ")}
    />
  );
}

function FittedInlineFrame({
  html,
  allow = [],
  fit: _fit,
  style,
  ref: outerRef,
  ...box
}: FrameBoxProps & {
  html: string;
  allow?: readonly Exclude<InlineFrameAllowance, "scripts">[];
  fit: true;
}) {
  // A nonce per document: a markup that names one cannot have guessed it.
  // `generation` re-mints it — a new srcdoc — when the frame navigated away.
  const [generation, setGeneration] = useState(0);
  const doc = useMemo(
    () => (generation >= 0 ? fitDocument(html, mintNonce()) : ""),
    [html, generation],
  );
  const frame = useRef<HTMLIFrameElement | null>(null);
  // Loads seen of the current srcdoc: its own is the first; any later one is
  // the frame navigating itself (a link or refresh a caller let through),
  // and a page navigated in would run with this frame's sandbox — so the
  // document is put back.
  const loads = useRef<{ doc: string; count: number }>({ doc: "", count: 0 });
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // Only this frame's document (an opaque origin: matched by its window).
      if (e.source === null || e.source !== frame.current?.contentWindow) {
        return;
      }
      const h = reportedHeight(e.data);
      if (h !== null) setHeight(h);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  return (
    <iframe
      {...box}
      ref={(el) => {
        frame.current = el;
        if (typeof outerRef === "function") outerRef(el);
        else if (outerRef) outerRef.current = el;
      }}
      srcDoc={doc}
      onLoad={() => {
        const seen = loads.current;
        if (seen.doc !== doc) {
          loads.current = { doc, count: 1 };
          return;
        }
        seen.count++;
        setGeneration((g) => g + 1);
      }}
      scrolling="no"
      style={{ ...style, height: height ?? 0 }}
      sandbox={["scripts", ...allow].map((a) => `allow-${a}`).join(" ")}
    />
  );
}

/**
 * A PDF the server serves (`application/pdf`, `nosniff`), in the browser's own
 * viewer — which a sandboxed frame cannot host, so it has none. Only an
 * {@link AssetPath} (resolved over the subtree's transport), never a URL, so
 * nothing but a served asset is framed unsandboxed.
 */
export function PdfFrame({
  asset,
  unloaded,
  ...box
}: FrameBoxProps & {
  asset: AssetPath;
  /** What shows while the asset loads, or why it cannot. */
  unloaded: (src: Exclude<AssetSrc, { kind: "ready" }>) => ReactNode;
}) {
  const src = useAssetSrc(asset);
  if (src.kind !== "ready") return unloaded(src);
  return <iframe {...box} src={src.src} />;
}

/**
 * The APP ITSELF — reviewed code — at an in-app path: on this page's own
 * origin, or on another namespace's (a worktree's preview). Unsandboxed: it is
 * the app, and a same-origin sandbox would add nothing. Takes a namespace and a
 * path, never a URL, so it cannot frame anything but an equin app.
 */
export function AppFrame({
  namespace,
  path,
  ...box
}: FrameBoxProps & {
  /** Another namespace's app; absent = this page's own origin. */
  namespace?: Namespace;
  /** An in-app path (`/agents/c/1?embed=1`). */
  path: string;
}) {
  // Another namespace is served by the same gateway as this page.
  const port = usePagePort();
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error(`AppFrame: path must be an in-app path — got "${path}"`);
  }
  return (
    <iframe
      {...box}
      src={namespace === undefined ? path : namespaceUrl(namespace, path, port)}
    />
  );
}
