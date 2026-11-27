// The document a mail body is framed as (`InlineFrame fit`, an opaque
// origin): the body under the reader's policy, on a light page of its own
// (mail is written for one). The policy is the boundary — the server's
// rewrite (`server/internal/render.ts`) only keeps mail working inside it:
//
// - images only from this server's mail routes (the image proxy and the
//   inline-part route — the sender never sees the reader) or `data:`;
// - inline styles, `data:` fonts; no stylesheet, font, media, frame, object,
//   form, worker, connection or base from anywhere.
//
// It names no `script-src` on purpose: the fitted frame's own policy admits
// only its height reporter, and a second policy can only narrow — a
// `default-src` here would block the reporter too.

/**
 * The policy, for the mail routes on `origin` (the page's own server) — or,
 * `null`, for a server no URL reaches (an in-browser one): `data:` images
 * only, its inline parts handed over as bytes, so nothing reaches the page's
 * server.
 */
export function mailFramePolicy(origin: string | null): string {
  return [
    origin === null ? "img-src data:" : `img-src ${origin}/api/mail/ data:`,
    "style-src 'unsafe-inline'",
    "font-src data:",
    "media-src 'none'",
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

/** The page every body is drawn on: the sender's own styles win over these. */
// The root is sized by its content, never the frame's viewport: the frame is
// sized to what the root reports (`InlineFrame fit`), so a body declaring
// `height:100%` or `min-height:100vh` would report the viewport back (0 at
// first, or growing by its own padding every frame). Author `!important`
// wins over the mail's own non-important rules and inline styles.
const BASE_STYLE = `html,body{height:auto!important;min-height:0!important}html{color-scheme:light}body{margin:0;padding:16px 18px;background:#fff;color:#1f2328;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}blockquote{margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex}`;

const DOCTYPE = /^\s*<!doctype[^>]*>/i;

/** `html` (a rewritten body) as the framed document, the policy first (`origin`: as {@link mailFramePolicy}). */
export function mailFrameDocument(html: string, origin: string | null): string {
  const head =
    `<meta http-equiv="Content-Security-Policy" content="${mailFramePolicy(origin)}">` +
    `<meta name="referrer" content="no-referrer">` +
    `<style>${BASE_STYLE}</style>`;
  const doctype = DOCTYPE.exec(html);
  return doctype
    ? doctype[0] + head + html.slice(doctype[0].length)
    : `<!doctype html>${head}${html}`;
}
