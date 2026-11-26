import {
  cn,
  SidewaysScrollProvider,
} from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import {
  SCROLLER_ATTR,
  useKeptScroll,
} from "@plugins/primitives/plugins/dom/plugins/auto-scroll/web";
import type { Transient } from "@plugins/primitives/plugins/kept-state/core";
import type { ScrollSite } from "../../core";
import { useInPopupSurface } from "@plugins/primitives/plugins/overlay/plugins/popup-open/web";
import { useMemo, type Ref, type RefCallback } from "react";
import type React from "react";
import "./scroll.css";

/**
 * Which axis (or axes) scrolls. `y` and `x` clamp the perpendicular axis to
 * `hidden` so a vertical scroller never grows a stray horizontal bar (and vice
 * versa); `both` opens both axes.
 */
export type ScrollAxis = "y" | "x" | "both";

/**
 * How a scroller's offset fares across a reload: kept under its call site
 * (`ScrollSite`, the build's default), kept under a name written for it, or
 * throwaway by design (`transient("<why>")`).
 */
export type ScrollKeep = string | ScrollSite | Transient;

/**
 * The name a scroller keeps under, and whether other scrollers of its scope
 * may share it. A call site is shared by design (one `<Scroll>` rendered once
 * per row) and then has no identity to tell its instances apart, so it keeps
 * while it is the only one in its scope (`instances: "many"`). A written name
 * is one scroller's: a second throws. The call site keeps nothing in a popup
 * (a reload never reopens one) or on a sideways scroller (only the vertical
 * offset is kept); a written name still does.
 */
function keptName(
  keep: ScrollKeep | undefined,
  axis: ScrollAxis,
  inPopup: boolean,
): {
  name: string | undefined;
  instances: "one" | "many";
  /** Why its offset is throwaway — the dev loss detector's mark — or "". */
  transientReason: string;
} {
  if (typeof keep === "string")
    return { name: keep, instances: "one", transientReason: "" };
  if (keep?.kind === "transient")
    return { name: undefined, instances: "one", transientReason: keep.reason };
  if (keep?.kind === "site" && inPopup)
    return {
      name: undefined,
      instances: "one",
      transientReason: "in a popup: a reload never reopens it",
    };
  if (keep?.kind === "site" && axis !== "x")
    return { name: keep.site, instances: "many", transientReason: "" };
  return { name: undefined, instances: "one", transientReason: "" };
}

const OVERFLOW_CLASS: Record<ScrollAxis, string> = {
  // A vertical scroller ALSO scrolls sideways while it holds content marked
  // `data-scrolls-x` — a grid table wider than its box (data-table), which
  // marks the boxes up to here `data-scroll-x-path` (`useScrollsSideways`),
  // this one included: the scroller keys on its own mark, not a `:has()`. The pane
  // stays the one scroller on both axes, so the table's sticky header (top)
  // and first column (left) pin to the same scroller; a scroller of the
  // table's own would capture the header's `top`. Meanwhile it is an
  // inline-size container, so a band pinned to its left edge sizes itself to
  // what is visible (`max-width: 100cqi`). Unmarked, nothing changes.
  y: "overflow-y-auto overflow-x-hidden data-scroll-x-path:overflow-x-auto data-scroll-x-path:[container-type:inline-size]",
  x: "overflow-x-auto overflow-y-hidden",
  both: "overflow-auto",
};

/**
 * The pure overflow + fill class map — the single source of truth for Scroll's
 * geometry, exported so the component and the pure test share one definition.
 *
 * `fill` emits the flex-child fill pair as ONE concern: a scroll pane inside a
 * flex column must be both `flex-1` (claim the leftover main-axis space) AND
 * `min-h-0` (allow shrinking below content height so the overflow actually
 * engages). Splitting `min-h-0` out re-exposes the "pane grows past its parent,
 * the whole page scrolls instead" footgun — so they live together. On a
 * horizontal scroller (`axis: "x"`) the same role is `min-w-0 flex-1`.
 */
export function scrollClasses(opts: {
  axis: ScrollAxis;
  fill: boolean;
  hideScrollbar: boolean;
  isolate: boolean;
}): string {
  return [
    OVERFLOW_CLASS[opts.axis],
    opts.fill
      ? opts.axis === "x"
        ? "min-w-0 flex-1"
        : "min-h-0 flex-1"
      : null,
    opts.hideScrollbar ? "hide-scrollbar" : null,
    opts.isolate ? "isolate" : null,
  ]
    .filter(Boolean)
    .join(" ");
}

export interface ScrollProps extends React.HTMLAttributes<HTMLElement> {
  /** Which axis scrolls. Defaults to `y`. */
  axis?: ScrollAxis;
  /** Emit the flex-child fill pair (`min-h-0 flex-1`, or `min-w-0 flex-1` on the
   *  `x` axis) so the pane fills its flex parent and the overflow engages.
   *  Defaults to false. */
  fill?: boolean;
  /** Hide the scrollbar chrome while keeping the content scrollable
   *  (`hide-scrollbar`). Defaults to false. */
  hideScrollbar?: boolean;
  /** Open a new stacking context (`isolate`) so descendant z-layers can't escape
   *  the pane. Defaults to false. */
  isolate?: boolean;
  /** Host element/component. Defaults to a `div`. */
  as?: React.ElementType;
  /** Forwarded to the rendered element (mirrors Surface/Card/Row). */
  ref?: React.Ref<HTMLElement>;
  /**
   * `y` axis: make this scroller a bleed region — a sideways scroller marked
   * `bleed` anywhere inside it may grow past its own column, up to this
   * scroller's width. Set it on a pane whose content is a centred column
   * narrower than the pane (a transcript's reading measure).
   *
   * `x` axis: this sideways scroller bleeds — inside a bleed region, content
   * that fits the column (wrapping as it can) stays the column's width;
   * content that cannot (its min-content is wider) takes its natural width,
   * growing past the column on both sides, centred, up to the region's
   * width, and scrolls sideways only beyond that. Outside a region it stays the
   * column's width.
   */
  bleed?: boolean;
  /**
   * How this scroller's offset fares across a page reload, within the
   * enclosing keep scope (auto-scroll's `KeepScrollScope` — every pane opens
   * one, keyed by its pane instance). Outside a scope nothing is kept.
   *
   * Leave it unset: the build writes the call site here (`ScrollSite`, this
   * plugin's `vite/index.ts`), so a vertical scroller is kept by default under
   * where it is written — while it is the only live instance of that call
   * site in its scope, and not inside a popup.
   *
   * - a name (`keep="pane"`): kept under it — for a scroller whose entry must
   *   survive its code moving, or one passed through a wrapper. Unique in its
   *   scope: two live scrollers under one name throw.
   * - `transient("<why>")`: throwaway by design (a picker's list that opens
   *   at its top); the reason is the review surface.
   *
   * Without the build's stamp (a test) an unset keep keeps nothing, and the
   * dev loss detector (`kept-state/loss-detector`) files a scrolled, unkept
   * main scroller as a `reload-loss`.
   */
  keep?: ScrollKeep;
}

/**
 * The sanctioned scroll-container primitive — owns overflow AND the flex-child
 * fill policy as a single role, the combination ~100 call sites re-derived by
 * hand as `min-h-0 flex-1 overflow-y-auto`. Supersedes the old "a genuine scroll
 * container is the canonical eslint-disable" guidance: reach for `<Scroll>`.
 *
 * Sizing stays in the caller's `className` — `h-*`/`max-h-*` are not banned, so a
 * fixed-height scroller is `<Scroll className="max-h-96">` and a full-height one
 * is `<Scroll className="h-full">`. The primitive owns only the overflow + fill
 * mechanics; the box's extent is the caller's concern.
 *
 * Caller `className` composes last.
 */
export function Scroll({
  axis = "y",
  fill = false,
  hideScrollbar = false,
  isolate = false,
  as: As = "div",
  ref,
  bleed = false,
  keep,
  className,
  children,
  ...rest
}: ScrollProps) {
  const bleeds = bleed && axis === "x";
  const { name, instances, transientReason } = keptName(
    keep,
    axis,
    useInPopupSurface(),
  );
  const kept = useKeptScroll(name, instances);
  // Stable across renders: a new callback ref would detach and re-attach the
  // scroller on every render.
  const scrollRef = useMemo(() => bothRefs(kept, ref), [kept, ref]);
  const scroller = (
    <As
      ref={scrollRef}
      className={cn(
        scrollClasses({ axis, fill, hideScrollbar, isolate }),
        bleeds ? null : className,
      )}
      // A vertical scroller is where a wide grid table may scroll sideways
      // (it opens the `SidewaysScroll` region below); the mark is what this
      // plugin's CSS keys the pinning of everything else on, and what the
      // table checks is the box actually clipping it.
      data-scroll-x-host={axis === "y" ? "" : undefined}
      // What the dev loss detector judges: a vertical scroller, and the reason
      // it is transient when it says so (auto-scroll's scroller marks).
      {...(axis === "x"
        ? {}
        : {
            [SCROLLER_ATTR]: transientReason,
          })}
      // Bleed: the region and the bleeding scroller are keyed on in scroll.css.
      data-bleed-region={bleed && axis === "y" ? "" : undefined}
      data-bleed={bleeds ? "" : undefined}
      {...rest}
    >
      {axis === "y" ? (
        <SidewaysScrollProvider value={true}>{children}</SidewaysScrollProvider>
      ) : bleeds ? (
        <div data-bleed-content="">{children}</div>
      ) : (
        children
      )}
    </As>
  );
  // A bleeding scroller sits in a column-wide anchor (scroll.css), which
  // takes the caller's className: the box in the flow is the anchor.
  return bleeds ? (
    <div data-bleed-anchor="" className={className}>
      {scroller}
    </div>
  ) : (
    scroller
  );
}

function bothRefs(
  own: RefCallback<HTMLElement>,
  theirs: Ref<HTMLElement> | undefined,
): RefCallback<HTMLElement> {
  return (el) => {
    own(el);
    if (typeof theirs === "function") theirs(el);
    else if (theirs) theirs.current = el;
  };
}
