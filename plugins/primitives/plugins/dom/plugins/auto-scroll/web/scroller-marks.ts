/**
 * What a scroller says about its offset across a reload, as DOM marks — read
 * by the dev loss detector (`kept-state/loss-detector`) to find a scroller a
 * reload would open at its top.
 *
 * - `data-scroller` — a `<Scroll>` (css/scroll) scrolling vertically; its
 *   value is empty, or the reason it is transient by design
 *   (`<Scroll keep={transient("<why>")}>`).
 * - `data-scroll-kept` — something keeps its offset: `useScrollAcrossReload`
 *   (every `<Scroll keep="…">` and `PaneScroll`) or a persisting
 *   `useStickyScroll`. Set by the keeper itself while it is attached, so a
 *   scroller is marked kept exactly when it is.
 * - `data-scroll-follows` — a `useStickyScroll` follower: at its bottom it is
 *   where a reload opens it anyway.
 */
export const SCROLLER_ATTR = "data-scroller";
const KEPT_ATTR = "data-scroll-kept";
const FOLLOWS_ATTR = "data-scroll-follows";

/** How a scroller's offset fares across a reload, from its marks. */
export type ScrollerKeep =
  | { kind: "kept"; key: string }
  | { kind: "transient"; reason: string }
  | { kind: "follows" }
  | { kind: "unkept" };

/** Read a scroller's keep from its marks. */
export function scrollerKeep(el: Element): ScrollerKeep {
  const key = el.getAttribute(KEPT_ATTR);
  if (key !== null) return { kind: "kept", key };
  const reason = el.getAttribute(SCROLLER_ATTR);
  if (reason !== null && reason !== "") return { kind: "transient", reason };
  if (el.hasAttribute(FOLLOWS_ATTR)) return { kind: "follows" };
  return { kind: "unkept" };
}

/** Mark `el` kept under `key` while it is; returns the unmark. */
export function markKept(el: HTMLElement, key: string): () => void {
  el.setAttribute(KEPT_ATTR, key);
  return () => {
    if (el.getAttribute(KEPT_ATTR) === key) el.removeAttribute(KEPT_ATTR);
  };
}

/** Mark `el` a stick-to-bottom follower while it is; returns the unmark. */
export function markFollows(el: HTMLElement): () => void {
  el.setAttribute(FOLLOWS_ATTR, "");
  return () => el.removeAttribute(FOLLOWS_ATTR);
}

/**
 * The element holding each kept key now. Two live scrollers sharing a key
 * would overwrite each other's saved offset, and the reload would put one
 * scroller's offset into the other: a loud failure, at the second's attach.
 */
const holders = new Map<string, HTMLElement>();

/** Claim `key` for `el`; throws when another live scroller holds it. Returns the release. */
export function claimKeptKey(el: HTMLElement, key: string): () => void {
  const held = holders.get(key);
  if (held !== undefined && held !== el && held.isConnected)
    throw new Error(
      `Two live scrollers keep their offset under "${key}": they would overwrite each other's saved offset. Give each its own \`keep\` name within its keep scope.`,
    );
  holders.set(key, el);
  return () => {
    if (holders.get(key) === el) holders.delete(key);
  };
}
