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

/** Whoever waits to hear that a scroller became a follower ({@link onFollows}). */
const followWatchers = new Map<HTMLElement, Set<() => void>>();

/** Mark `el` a stick-to-bottom follower while it is; returns the unmark. */
export function markFollows(el: HTMLElement): () => void {
  el.setAttribute(FOLLOWS_ATTR, "");
  for (const watcher of [...(followWatchers.get(el) ?? [])]) watcher();
  return () => el.removeAttribute(FOLLOWS_ATTR);
}

/**
 * Call `then` once `el` is a stick-to-bottom follower — now, when it already
 * is, else when {@link markFollows} marks it. A follower owns its scroller's
 * offset (it pins the bottom, or keeps its own reading position when it
 * persists), so a reload keep on the same scroller stands down through this:
 * the follower marks its scroller in a passive effect, after the scroller's
 * own keep attached. Returns the stop.
 */
export function onFollows(el: HTMLElement, then: () => void): () => void {
  if (el.hasAttribute(FOLLOWS_ATTR)) {
    then();
    return () => {};
  }
  let watchers = followWatchers.get(el);
  if (watchers === undefined) followWatchers.set(el, (watchers = new Set()));
  // Once: a follower marks again whenever its sentinel or persist key changes.
  const stop = () => {
    watchers.delete(once);
    if (watchers.size === 0 && followWatchers.get(el) === watchers)
      followWatchers.delete(el);
  };
  const once = () => {
    stop();
    then();
  };
  watchers.add(once);
  return stop;
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

/**
 * Live scrollers keeping under a key shared by design — a call site's — each
 * with how it stands down; and the keys found rendered more than once at a
 * time in this document.
 */
const sharedHolders = new Map<string, Map<HTMLElement, () => void>>();
const ambiguousKeys = new Set<string>();

/**
 * Claim `key` for `el` when several scrollers may carry it by design (one
 * call site rendered more than once in a scope: a code block per row, a card
 * per item). Those instances have nothing that tells them apart across a
 * reload — numbering them by mount order puts one's offset into another once
 * anything mounted, unmounted or moved — so the key keeps only while ONE
 * scroller holds it. The moment a second live scroller claims it, every holder
 * stands down (`standDown`: it drops its mark and its entry) and the key keeps
 * nothing for the rest of this document.
 *
 * Returns the release, or `null` when `el` keeps nothing under it.
 */
export function claimSharedKey(
  el: HTMLElement,
  key: string,
  standDown: () => void,
): (() => void) | null {
  if (ambiguousKeys.has(key)) return null;
  const live = sharedHolders.get(key) ?? new Map<HTMLElement, () => void>();
  for (const other of [...live.keys()])
    if (other !== el && !other.isConnected) live.delete(other);
  if ([...live.keys()].some((other) => other !== el)) {
    ambiguousKeys.add(key);
    sharedHolders.delete(key);
    for (const down of live.values()) down();
    return null;
  }
  live.set(el, standDown);
  sharedHolders.set(key, live);
  return () => {
    if (live.get(el) !== standDown) return;
    live.delete(el);
    if (live.size === 0 && sharedHolders.get(key) === live)
      sharedHolders.delete(key);
  };
}
