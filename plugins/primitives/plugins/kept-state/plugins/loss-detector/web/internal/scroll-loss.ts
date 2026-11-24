import {
  SCROLLER_ATTR,
  scrollerKeep,
} from "@plugins/primitives/plugins/dom/plugins/auto-scroll/web";

/** A pane's main scroller the user scrolled, which a reload would open at its top. */
export interface ScrollLoss {
  /** The pane holding it (`data-pane-id`). */
  pane: string;
  /** `Name@<file>:<line>` of the component rendering the `<Scroll>` (element-picker's stamp). */
  uiOwner?: string;
  /** `<file>:<line>` of the element itself, when stamped. */
  source?: string;
  /** Where it was, rounded: `top 1200 of 4800`. */
  offset: string;
}

/**
 * A scroller at least this share of its pane's height is the pane's main
 * scroller — the box a person reads the pane in (a body that fills the pane,
 * `h-full`). A smaller one (a capped list inside a card) is not judged.
 */
const MAIN_SHARE = 0.5;

/** Distance from the bottom still counted as "at the bottom" for a follower. */
const FOLLOW_SLACK_PX = 50;

/**
 * Judge one scroller where it settled: a loss when it is a pane's main
 * scroller, scrolled away from its top, and nothing keeps its offset — not
 * kept (`<Scroll keep="…">`, `PaneScroll`, a persisting `useStickyScroll`),
 * not transient by its own say, and not a follower resting at its bottom
 * (where a reload opens it anyway). `null` when there is nothing to report.
 */
export function judgeScroller(el: HTMLElement): ScrollLoss | null {
  if (el.scrollTop <= 0) return null;
  const keep = scrollerKeep(el);
  if (keep.kind === "kept" || keep.kind === "transient") return null;
  if (
    keep.kind === "follows" &&
    el.scrollHeight - el.clientHeight - el.scrollTop <= FOLLOW_SLACK_PX
  )
    return null;
  const pane = el.closest<HTMLElement>("[data-pane-id]");
  if (pane === null) return null;
  if (el.clientHeight < pane.clientHeight * MAIN_SHARE) return null;
  const uiOwner = el.getAttribute("data-ui-owner") ?? undefined;
  const source = el.getAttribute("data-source") ?? undefined;
  return {
    pane: pane.getAttribute("data-pane-id") ?? "",
    ...(uiOwner !== undefined ? { uiOwner } : {}),
    ...(source !== undefined ? { source } : {}),
    offset: `top ${Math.round(el.scrollTop)} of ${Math.round(el.scrollHeight)}`,
  };
}

/** How long after a scroller's last scroll event it counts as settled. */
const SETTLE_MS = 400;

/**
 * Watch every `<Scroll>` the page scrolls (one capture listener on the
 * document — `scroll` does not bubble) and, once a scroller settles, report it
 * when `judgeScroller` says a reload would lose where it is: at the scroll
 * itself, not at an unmount, since a hidden tab's scrollers read 0 by then.
 * Each place (owner stamp, else source, else pane) is reported once per page.
 * Returns the stop.
 */
export function watchScrollLoss(
  onLoss: (loss: ScrollLoss) => void,
): () => void {
  const seen = new Set<string>();
  const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  const settle = (el: HTMLElement) => {
    timers.delete(el);
    if (!el.isConnected) return;
    const loss = judgeScroller(el);
    if (loss === null) return;
    const key = loss.uiOwner ?? loss.source ?? loss.pane;
    if (seen.has(key)) return;
    seen.add(key);
    onLoss(loss);
  };
  // Trailing debounce per scroller, not a poll: a scroll emits events at
  // input frequency, and only where it settles is judged.
  const onScroll = (event: Event) => {
    const el = event.target;
    if (!(el instanceof HTMLElement) || !el.hasAttribute(SCROLLER_ATTR)) return;
    const pending = timers.get(el);
    if (pending !== undefined) clearTimeout(pending);
    timers.set(
      el,
      setTimeout(() => settle(el), SETTLE_MS),
    );
  };
  document.addEventListener("scroll", onScroll, {
    capture: true,
    passive: true,
  });
  return () => {
    document.removeEventListener("scroll", onScroll, { capture: true });
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  };
}
