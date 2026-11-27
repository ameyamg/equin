import { useEffect, useRef, type RefObject } from "react";
import { createInViewWatcher } from "@plugins/primitives/plugins/dom/plugins/in-view/web";
import { registerPageSection, track } from "./instance";
import { SECTION_REACH_EVENT, SECTION_REACH_PROP } from "../../core";

/**
 * Records `section_reach` once when `el` is first being read: its top has
 * passed the middle of the screen (scrolled far enough to be reading it, not
 * merely to see its top edge peek in), or the whole of it is on screen. A
 * section taller than the screen counts as soon as its top passes the middle,
 * so a long band is not missed for never fitting; a short one at the end of a
 * page (the footer) counts once it is all in view, since its top may never
 * get above the middle however far the page scrolls.
 *
 * `section` is `<page>/<key>` (`landing/hero`, `vision/idea`): a prop value is
 * reported across every path, so the page is part of it.
 *
 * Once per observation: the observer disconnects after it fires, and returns a
 * disposer for a section unmounted before it is reached. A page shown again
 * mounts again, and is a new pageview, so it counts again.
 *
 * Every observed section is also listed in its page's full section list
 * (`registerPageSection`), reached or not — what "read %" is measured
 * against. So a part of a page counts toward it exactly when it is observed.
 */
export function observeSectionReach(el: Element, section: string): () => void {
  const unregister = registerPageSection(el, section);
  // Either rule reaches it; whichever fires first records it and stops both.
  let done = false;
  const reached = () => {
    if (done) return;
    done = true;
    pastMiddle.disconnect();
    wholly.disconnect();
    track(SECTION_REACH_EVENT, { [SECTION_REACH_PROP]: section });
  };
  const pastMiddle = createInViewWatcher(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) reached();
    },
    // the viewport, clipped by every scrolling ancestor (the pane included),
    // with its lower half cut off
    { rootMargin: "0px 0px -50% 0px" },
  );
  const wholly = createInViewWatcher(
    (entries) => {
      if (entries.some((e) => e.isIntersecting && e.intersectionRatio >= 1))
        reached();
    },
    { threshold: 1 },
  );
  pastMiddle.observe(el);
  wholly.observe(el);
  return () => {
    pastMiddle.disconnect();
    wholly.disconnect();
    unregister();
  };
}

/** {@link observeSectionReach} for a React element: attach the returned ref to the section. */
export function useSectionReach<T extends Element>(
  section: string,
): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el)
      throw new Error(
        `[analytics] useSectionReach("${section}"): ref not attached`,
      );
    return observeSectionReach(el, section);
  }, [section]);
  return ref;
}
