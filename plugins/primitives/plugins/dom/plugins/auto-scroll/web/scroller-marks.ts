/**
 * What a scroller says about its offset across a reload, as DOM marks — read
 * by the dev loss detector (`kept-state/loss-detector`) to find a scroller a
 * reload would open at its top.
 *
 * - `data-scroller` — a `<Scroll>` (css/scroll) scrolling vertically; its
 *   value is empty, or the reason it is transient by design
 *   (`<Scroll keep={transient("<why>")}>`).
 * - `data-scroll-kept` — something keeps its offset: `useScrollAcrossReload`
 *   (every `<Scroll keep="…">` and `PaneScroll`, a follower's included unless
 *   it persists) or a persisting `useStickyScroll`. Set by the keeper itself
 *   while it is attached, so a scroller is marked kept exactly when it is.
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

/**
 * Every keeper marking each scroller now, in the order they marked it. A
 * scroller can carry two at once — its `<Scroll>`'s reload keep and a
 * persisting follower's — and either can let go first: the mark is theirs
 * jointly, so one letting go never takes another's with it.
 */
const keepers = new WeakMap<HTMLElement, { key: string }[]>();

/**
 * Mark `el` kept under `key` while it is; returns the unmark. The attribute
 * names the latest keeper still holding it, and goes only when none does.
 */
export function markKept(el: HTMLElement, key: string): () => void {
  const mark = { key };
  const held = keepers.get(el) ?? [];
  held.push(mark);
  keepers.set(el, held);
  el.setAttribute(KEPT_ATTR, key);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const at = held.indexOf(mark);
    if (at !== -1) held.splice(at, 1);
    const latest = held.at(-1);
    if (latest !== undefined) {
      el.setAttribute(KEPT_ATTR, latest.key);
      return;
    }
    if (keepers.get(el) === held) keepers.delete(el);
    el.removeAttribute(KEPT_ATTR);
  };
}

/** A stick-to-bottom follower on a scroller, as the scroller's reload keep sees it. */
export interface FollowerMark {
  /**
   * It keeps the reader's place itself (`useStickyScroll({ persist })`): the
   * reload keep stands down for good. A follower that does not persist leaves
   * the reload to the keep, which saves the offset only while it is parked.
   */
  readonly persists: boolean;
  /**
   * Where it stands now: chasing the bottom, being moved by the reader (until
   * their scroll settles), or parked where the reader left it.
   */
  stance(): "following" | "driving" | "parked";
}

const followers = new Map<HTMLElement, FollowerMark>();
/** Whoever watches a scroller's follower ({@link watchFollower}). */
const followWatchers = new Map<HTMLElement, Set<(f: FollowerMark) => void>>();

function tellWatchers(el: HTMLElement, follower: FollowerMark): void {
  for (const watcher of [...(followWatchers.get(el) ?? [])]) watcher(follower);
}

/** Mark `el` a stick-to-bottom follower while it is; returns the unmark. */
export function markFollows(
  el: HTMLElement,
  follower: FollowerMark,
): () => void {
  el.setAttribute(FOLLOWS_ATTR, "");
  followers.set(el, follower);
  tellWatchers(el, follower);
  return () => {
    if (followers.get(el) !== follower) return;
    followers.delete(el);
    el.removeAttribute(FOLLOWS_ATTR);
  };
}

/** The follower on `el` changed its stance ({@link FollowerMark.stance}). */
export function followerMoved(el: HTMLElement): void {
  const follower = followers.get(el);
  if (follower !== undefined) tellWatchers(el, follower);
}

/**
 * Call `then` with `el`'s follower whenever it marks the scroller (now, when
 * it already has) and whenever its stance changes ({@link followerMoved}). A follower marks its scroller in a passive effect,
 * after the scroller's own keep attached, so the keep learns of it through
 * this. Returns the stop.
 */
export function watchFollower(
  el: HTMLElement,
  then: (follower: FollowerMark) => void,
): () => void {
  let watchers = followWatchers.get(el);
  if (watchers === undefined) followWatchers.set(el, (watchers = new Set()));
  const watcher = (f: FollowerMark) => then(f);
  watchers.add(watcher);
  const now = followers.get(el);
  if (now !== undefined) then(now);
  return () => {
    watchers.delete(watcher);
    if (watchers.size === 0 && followWatchers.get(el) === watchers)
      followWatchers.delete(el);
  };
}

/**
 * Scrollers whose reload keep is putting a saved offset back now, each with
 * who must hear if the keep gives the restore up without the reader having
 * taken over ({@link joinReloadRestore}).
 */
const restoring = new Map<HTMLElement, Set<() => void>>();

/**
 * The reload keep starts putting `el`'s saved offset back. Returns the end:
 * `abandoned` when the keep stood down without the reader taking over (the
 * offset will not be put back after all).
 */
export function beginReloadRestore(
  el: HTMLElement,
): (abandoned: boolean) => void {
  const abandons = new Set<() => void>();
  restoring.set(el, abandons);
  return (abandoned) => {
    if (restoring.get(el) !== abandons) return;
    restoring.delete(el);
    if (abandoned) for (const abandon of abandons) abandon();
  };
}

/**
 * Whether `el`'s reload keep is putting back an offset saved before this
 * reload — the place a follower that does not persist was parked at. When it
 * is, the follower starts parked instead of pinning the bottom, and
 * `onAbandon` runs if the keep gives the restore up (the follower then
 * follows). The keep attaches in the scroller's layout effect, which runs
 * before the follower's mount restore: the scroller is the follower's
 * descendant, and both wait on a node set in the same commit.
 */
export function joinReloadRestore(
  el: HTMLElement,
  onAbandon: () => void,
): boolean {
  const abandons = restoring.get(el);
  if (abandons === undefined) return false;
  abandons.add(onAbandon);
  return true;
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
