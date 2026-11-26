import {
  decodeHtmlText,
  rewriteStartTags,
  scanHtml,
  type StartTagRewriter,
} from "@plugins/infra/plugins/html-decode/core";

// A mail body made safe to frame. The frame is the boundary — an opaque
// origin, and the page's policy (`web/internal/mail-frame.ts`) admits no
// script of the body's, no request but this server's image and part routes,
// no form, no frame, no base — so this rewrite is not what keeps the reader
// safe. It is what keeps the mail WORKING inside that policy: remote images
// through the proxy (the sender never sees the reader's address; tracking
// pixels still fire, the user's call: load by default through the proxy),
// `cid:` images through the inline-part route, links opening a tab. What it
// does not rewrite (a remote image in a `<style>` block) the policy blocks; a
// relative one resolves against the page and reaches this server anonymous,
// where only the signed routes answer.
// It also cuts what the policy cannot — no policy stops a frame navigating
// ITSELF, and a page navigated in would run with the frame's sandbox
// (scripts, popups): a `<meta http-equiv="refresh">`, and every link that
// would open in the frame (any `<a>` / `<area>`, SVG's `xlink:href` too: an
// http(s) or mailto one opens a new tab, an in-page `#` one stays, anything
// else is blanked). `<link>` prefetches would reach the sender: cut too. The
// fitted frame re-mounts its document on any navigation it still sees
// (`InlineFrame fit`), the last line.

/** Where the rewritten URLs point: null when a URL is not served (an unknown `cid:`). */
export type BodyLinks = {
  /** A remote `http(s)` image, as the proxy route's path. */
  image(url: string): string | null;
  /** An inline part by its `Content-ID`, as the inline-part route's path. */
  inline(contentId: string): string | null;
};

/** Tags whose `background` attribute is an image URL (old table layouts). */
const BACKGROUND_TAGS = ["body", "table", "tr", "td", "th"];
/** Tags whose inline `style` commonly carries a `url(…)` background. */
const STYLED_TAGS = [
  "body",
  "table",
  "tr",
  "td",
  "th",
  "div",
  "span",
  "p",
  "a",
  "center",
  "section",
  "header",
  "footer",
  "h1",
  "h2",
  "h3",
];

const CSS_URL = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;

/** `src` as an absolute remote URL, or null (protocol-relative read as https). */
function remoteUrl(src: string): string | null {
  const s = src.trim();
  if (s.startsWith("//")) return `https:${s}`;
  return /^https?:\/\//i.test(s) ? s : null;
}

/** An image reference as what the frame may load: proxied, an inline part, a data image, or nothing. */
function resolveImage(src: string, links: BodyLinks): string {
  const s = src.trim();
  if (/^cid:/i.test(s)) {
    const id = decodeURIComponentSafe(s.slice(4)).replace(/^<|>$/g, "");
    return links.inline(id) ?? "";
  }
  if (/^data:image\//i.test(s)) return s;
  const remote = remoteUrl(s);
  return remote === null ? "" : (links.image(remote) ?? "");
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch (err) {
    if (err instanceof URIError) return s;
    throw err;
  }
}

function rewriteStyle(style: string, links: BodyLinks): string {
  return style.replace(
    CSS_URL,
    (_m, _q: string, url: string) => `url("${resolveImage(url, links)}")`,
  );
}

/** Every remote image URL the body names where the rewrite proxies it — what the server signs before rendering. */
export function remoteImageUrls(html: string): string[] {
  const out = new Set<string>();
  const add = (src: string | undefined) => {
    if (src === undefined) return;
    const remote = remoteUrl(src);
    if (remote !== null) out.add(remote);
  };
  const styled = (el: { attr(n: string): string | undefined }) => {
    const style = el.attr("style");
    if (style === undefined) return;
    for (const m of style.matchAll(CSS_URL)) add(m[2]);
  };
  const elements: Record<
    string,
    (el: { attr(n: string): string | undefined }) => void
  > = {};
  for (const t of STYLED_TAGS) elements[t] = styled;
  for (const t of BACKGROUND_TAGS) {
    elements[t] = (el) => {
      add(el.attr("background"));
      styled(el);
    };
  }
  elements.img = (el) => {
    add(el.attr("src"));
    styled(el);
  };
  scanHtml(html, { elements });
  return [...out];
}

/** The body, rewritten to work inside the mail frame's policy (see the file comment). */
export function renderMailHtml(html: string, links: BodyLinks): string {
  const styled = (el: StartTagRewriter) => {
    const style = el.attr("style");
    if (style !== undefined && /url\(/i.test(style)) {
      el.setAttribute("style", rewriteStyle(style, links));
    }
  };
  const edits: Record<string, (el: StartTagRewriter) => void> = {};
  for (const t of STYLED_TAGS) edits[t] = styled;
  for (const t of BACKGROUND_TAGS) {
    edits[t] = (el) => {
      const bg = el.attr("background");
      if (bg !== undefined)
        el.setAttribute("background", resolveImage(bg, links));
      styled(el);
    };
  }
  edits.img = (el) => {
    const src = el.attr("src");
    el.setAttribute("src", src === undefined ? "" : resolveImage(src, links));
    // A responsive set would name URLs the rewrite did not: one image only.
    if (el.attr("srcset") !== undefined) el.setAttribute("srcset", "");
    styled(el);
  };
  const link = (el: StartTagRewriter) => {
    for (const name of ["href", "xlink:href"]) {
      const raw = el.attr(name);
      if (raw === undefined) continue;
      const href = raw.trim();
      if (href.startsWith("#")) continue;
      const remote = remoteUrl(href);
      if (remote !== null || /^mailto:/i.test(href)) {
        el.setAttribute(name, remote ?? href);
      } else {
        el.setAttribute(name, "");
      }
    }
    // Every link opens away from the frame, whatever it names.
    el.setAttribute("target", "_blank");
    el.setAttribute("rel", "noopener noreferrer");
    styled(el);
  };
  edits.a = link;
  edits.area = link;
  // Neutralised by a value, never removed: a repeat of the name would take
  // over once the first is gone (`removeAttribute`'s caveat).
  edits.meta = (el) => {
    if (el.attr("http-equiv") !== undefined) {
      el.setAttribute("http-equiv", "x-equin-removed");
    }
  };
  edits.link = (el) => {
    el.setAttribute("rel", "");
    el.setAttribute("href", "");
  };
  edits.base = (el) => {
    if (el.attr("href") !== undefined) el.setAttribute("href", "");
  };
  return rewriteStartTags(html, edits);
}

const PREVIEW_MAX = 200;

/** One line of a message's text, for a folded message: its text body, else its HTML's text. */
export function messagePreview(
  text: string | null,
  html: string | null,
): string {
  let plain = text;
  if (plain === null && html !== null) {
    plain = decodeHtmlText(
      html
        .replace(/<(style|script|head|title)\b[\s\S]*?<\/\1\s*>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<[^>]*>/g, " "),
    );
  }
  const line = (plain ?? "")
    // A reply's quoted history is not what it says.
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith(">"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return line.length > PREVIEW_MAX
    ? `${line.slice(0, PREVIEW_MAX - 1)}…`
    : line;
}
