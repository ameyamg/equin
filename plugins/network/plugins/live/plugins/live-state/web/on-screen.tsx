import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createInViewWatcher } from "@plugins/primitives/plugins/dom/plugins/in-view/web";

// Whether the reads mounted under a box are on screen — what decides if a read
// still waiting for its first value holds the page "not ready yet"
// (pending-mount-tracker.ts). A read off screen (a transcript row scrolled
// away, a tab not shown) is drawn by nobody, so the page a person is looking
// at is ready without it; once it comes back on screen while still waiting,
// it holds the page again.
//
// The answer comes from what is drawn, never from the read: a container that
// knows its box is on screen or not (a tab's own focus, an
// IntersectionObserver on a row) says so for everything under it. Nested
// scopes AND together: a row on screen inside a hidden tab is off screen. No
// scope anywhere above a read: on screen.

const OnScreenContext = createContext(true);

/** Whether this subtree is on screen (every enclosing {@link OnScreenScope} is). */
export function useOnScreen(): boolean {
  return useContext(OnScreenContext);
}

/**
 * Marks a subtree on screen or not, as its container draws it. Nested under
 * an off-screen scope it is off screen whatever it says.
 */
export function OnScreenScope({
  onScreen,
  children,
}: {
  onScreen: boolean;
  children: ReactNode;
}) {
  const parent = useContext(OnScreenContext);
  return (
    <OnScreenContext.Provider value={parent && onScreen}>
      {children}
    </OnScreenContext.Provider>
  );
}

/**
 * Whether `box` intersects the screen now — its scrollers' clips included, so
 * a row scrolled out of its list is off screen, as is a box in a
 * `display: none` subtree. On screen until the first observation: a read must
 * not stop counting before anything has looked (a page declared ready while
 * its rows were still being measured).
 */
export function useBoxOnScreen(box: RefObject<HTMLElement | null>): boolean {
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const el = box.current;
    if (el === null) return;
    const watcher = createInViewWatcher((entries) => {
      const last = entries[entries.length - 1];
      if (last !== undefined) setOnScreen(last.isIntersecting);
    });
    watcher.observe(el);
    return () => watcher.disconnect();
  }, [box]);
  return onScreen;
}
