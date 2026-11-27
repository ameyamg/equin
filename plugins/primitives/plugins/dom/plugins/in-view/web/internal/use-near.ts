import { useEffect, useState, type RefObject } from "react";

import { createInViewWatcher } from "./in-view";

export type UseNearOptions = {
  /**
   * How far outside the scroller's visible box still counts as near
   * (IntersectionObserver `rootMargin`; percentages are of the scroller).
   * Default: half a scroller below and above.
   */
  rootMargin?: string;
  /**
   * The scroller the box scrolls in, found from the box itself (e.g.
   * auto-scroll's `findScrollParent`). Omitted: the viewport — an inner
   * scroller's clip still hides what is below its edge, but the margin then
   * extends only the viewport. Pass a stable (module-level) function.
   */
  scrollRoot?: (box: HTMLElement) => Element | null;
};

/**
 * Whether `box` is near the visible part of its scroller NOW: `false` until
 * the first observation, then following the box both ways — unlike
 * `MountWhenNear`, which latches. A box in a hidden subtree (`display: none`,
 * a resident tab not on screen) is never near.
 *
 * For what a box holds only while someone can see it: a list row's live
 * reads, so what a long list keeps subscribed is the rows near the screen,
 * not every row it mounted.
 */
export function useNear(
  box: RefObject<HTMLElement | null>,
  { rootMargin = "50% 0px", scrollRoot }: UseNearOptions = {},
): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (el === null) return;
    const found = scrollRoot?.(el) ?? null;
    // The document's own scroller is the window, not a box: as an observer
    // root `<html>` measures against its whole (unclipped) height.
    const root =
      found === document.scrollingElement || found === document.documentElement
        ? null
        : found;
    const watcher = createInViewWatcher(
      (entries) => {
        const last = entries[entries.length - 1];
        if (last !== undefined) setNear(last.isIntersecting);
      },
      { root, rootMargin },
    );
    watcher.observe(el);
    return () => watcher.disconnect();
  }, [box, rootMargin, scrollRoot]);
  return near;
}
