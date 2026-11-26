// The document a content-height InlineFrame frames (`InlineFrame fit`): the
// caller's markup with, ahead of anything of its own, a policy that admits
// ONE script — ours, by a nonce minted per document — and that script, which
// reports the document's height to the parent. The markup's own scripts,
// inline handlers and `javascript:` URLs stay blocked, as in a frame with no
// `allow-scripts` at all: the sandbox lets scripts run, the policy lets only
// the reporter. A policy once applied cannot be removed by the page, and a
// second one (the caller's, or the markup's) can only narrow it — which is
// why the caller's own policy must leave `script-src` to this one.

/** The message the reporter posts: the frame document's height, in CSS px. */
export const FIT_HEIGHT_MESSAGE = "equin-inline-frame-height";

/** A reported height past this is a lie (a hostile page cannot post one: only the reporter runs) or a runaway layout: clamped. */
export const FIT_MAX_HEIGHT = 200_000;

const DOCTYPE = /^\s*<!doctype[^>]*>/i;

/** A nonce: 128 random bits, base64. */
export function mintNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * The reporter, as source: the root element's laid-out height — its content,
 * not the viewport (the frame is sized to what it reports, so the viewport's
 * height would only ever confirm itself) — posted on every resize and once
 * loaded (late images).
 */
function reporter(): string {
  return `(function(){var last=-1;function post(){var h=Math.ceil(document.documentElement.getBoundingClientRect().height);if(h===last)return;last=h;parent.postMessage({type:${JSON.stringify(FIT_HEIGHT_MESSAGE)},height:h},"*")}new ResizeObserver(post).observe(document.documentElement);addEventListener("load",post);post()})()`;
}

/**
 * `html` framed to fit: the script policy and the reporter placed right after
 * the doctype (keeping standards mode) — the parser opens an implicit
 * `<head>` for them, so they apply before anything the markup carries.
 */
export function fitDocument(html: string, nonce: string): string {
  const head =
    `<meta http-equiv="Content-Security-Policy" content="script-src 'nonce-${nonce}'">` +
    `<script nonce="${nonce}">${reporter()}</script>`;
  const doctype = DOCTYPE.exec(html);
  return doctype
    ? doctype[0] + head + html.slice(doctype[0].length)
    : head + html;
}

/** The height a message from the frame reports, or null when it is not the reporter's. */
export function reportedHeight(data: unknown): number | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as { type?: unknown; height?: unknown };
  if (d.type !== FIT_HEIGHT_MESSAGE || typeof d.height !== "number") {
    return null;
  }
  if (!Number.isFinite(d.height) || d.height < 0) return null;
  return Math.min(Math.ceil(d.height), FIT_MAX_HEIGHT);
}
