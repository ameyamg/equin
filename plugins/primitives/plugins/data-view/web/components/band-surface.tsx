import { useState, type CSSProperties, type ReactNode } from "react";
import {
  useElementSize,
  useResizeObserver,
} from "@plugins/primitives/plugins/dom/plugins/element-size/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Sticky } from "@plugins/primitives/plugins/css/plugins/sticky/web";
import { Scroll } from "@plugins/primitives/plugins/css/plugins/scroll/web";
import { Pin } from "@plugins/primitives/plugins/css/plugins/pin/web";
import { Layer } from "@plugins/primitives/plugins/css/plugins/layer/web";
import { Clip } from "@plugins/primitives/plugins/css/plugins/clip/web";
import { Surface } from "@plugins/primitives/plugins/css/plugins/surface/web";
import { OverlayInteractive } from "@plugins/primitives/plugins/css/plugins/overlay/web";
import { yieldClass } from "@plugins/primitives/plugins/css/plugins/yield/web";
import { fillClasses } from "@plugins/primitives/plugins/css/plugins/fill/web";
import { rigidClass } from "@plugins/primitives/plugins/css/plugins/rigid/web";
import { spaceLength } from "@plugins/primitives/plugins/css/plugins/space-ramp/core";
import {
  DATA_VIEW_HEADER_OFFSET_VAR,
  DATA_VIEW_MEASURE_VAR,
  type DataViewReserve,
} from "../../core";
import { findScrollParent } from "@plugins/primitives/plugins/dom/plugins/auto-scroll/web";
import {
  DataViewControlsProvider,
  type DataViewControlsContextValue,
} from "./controls/controls-context";

/** The gap between a floating card (the aside) and the surface's edges. */
const GUTTER = "md";

/**
 * How a band surface lays out its three parts — the toolbar band, the
 * surface's `aside`, and the view body — and the one place the controls
 * context reaches beyond the band: it wraps the band AND the aside (two
 * providers of one value), never the body, so a view still sees only its
 * `DataViewRenderProps` contract.
 *
 * - **In-flow band, no aside**: band then body, exactly as always.
 * - **In-flow band + aside**: the aside is a left column (pinned to the
 *   scroller's top as the rows scroll), and the band and body share the rest.
 * - **Overlay arrangement** (`ToolbarArrangement.overlay`): the shell root
 *   fills its parent; the body renders in the surface's scroller, and the band
 *   (which positions itself, see `DataViewToolbar`) and the aside's floating
 *   card ride over it. A `fullBleed` view starts at the top-left edge, under
 *   them; any other view is inset by the band's measured height
 *   (`--dv-header-offset`, which its sticky group headers also pin at) and the
 *   aside's reach, so its first row clears the cards.
 * - **Overlay + backdrop** (`DataViewProps.backdrop`): the backdrop view fills
 *   the surface at ONE tree position whatever view is active, so it never
 *   remounts; any other view floats over it as a card — below the band, past
 *   the aside, a gutter from the bottom and from the right edge's `reserve`
 *   (and the `asideEnd`) — scrolling inside it, its sticky headers pinned at
 *   the card's top.
 * - **Overlay + asideEnd** (`DataViewProps.asideEnd`): a floating card on the
 *   right, below the band, a gutter from the bottom and from `reserve.right`,
 *   inside the controls context like the aside. Overlay only (throws else).
 */
export function BandSurface(props: {
  /** Whether the toolbar arrangement floats its band over the view. */
  overlay: boolean;
  /** The surface's side panel, or `undefined`. */
  aside: ReactNode;
  /** The surface's right-hand panel (`DataViewProps.asideEnd`). Overlay only. */
  asideEnd?: ReactNode;
  /** Room the surface's own chrome covers (`DataViewProps.reserve`): the
   *  floating cards on the right stop a gutter short of it. */
  reserve?: DataViewReserve;
  /** The active view type's `fullBleed`. */
  fullBleed: boolean;
  controls: DataViewControlsContextValue;
  /** Renders the toolbar band, given `ToolbarParts.asideInset`. */
  band: (asideInset: string) => ReactNode;
  /** The reading column's width (`DataViewProps.measure`): the body is
   *  centred in a column at most this wide, published as `--dv-measure`.
   *  In-flow bands only (the shell refuses it beside an overlay). */
  measure?: string;
  /** The view body. */
  children: ReactNode;
  /**
   * The backdrop view (`DataViewProps.backdrop`), already rendered, with
   * whether the body floats over it as a card (`panel: false` while the
   * active view IS the backdrop — the body is then not shown). Overlay only.
   */
  backdrop?: { node: ReactNode; panel: boolean };
}): ReactNode {
  const {
    overlay,
    aside,
    asideEnd,
    reserve,
    fullBleed,
    controls,
    band,
    measure,
    backdrop,
  } = props;
  // The reading column: the body centred, at most `measure` wide.
  const children =
    measure === undefined ? (
      props.children
    ) : (
      <div className="mx-auto w-full max-w-(--dv-measure)">
        {props.children}
      </div>
    );
  const measureStyle: CSSProperties | undefined =
    measure === undefined
      ? undefined
      : ({ [DATA_VIEW_MEASURE_VAR]: measure } as CSSProperties);
  const [asideRef, asideWidth] = useElementSize((s) => s.width);
  // An in-flow aside is a column as tall as the scroller's viewport (pinned
  // to its top), scrolling inside itself — so it fills the pane under the
  // tab bar, never a guess like `100dvh` that overshoots by the chrome. The
  // viewport is the scroller's client box (padding in, borders out); the
  // document's own scroller's viewport is the window's.
  const [asideColumn, setAsideColumn] = useState<HTMLElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState<string | null>(null);
  const scrollerOf = (el: HTMLElement): HTMLElement => findScrollParent(el);
  useResizeObserver(
    () => (asideColumn === null ? null : scrollerOf(asideColumn)),
    () => {
      if (asideColumn === null) return;
      const scroller = scrollerOf(asideColumn);
      const next =
        scroller === document.scrollingElement
          ? "100dvh"
          : `${scroller.clientHeight}px`;
      setViewportHeight((prev) => (prev === next ? prev : next));
    },
    { deps: [asideColumn] },
  );
  const [asideEndRef, asideEndWidth] = useElementSize((s) => s.width);
  const hasAside = aside !== undefined;
  const hasAsideEnd = asideEnd !== undefined;
  if (hasAsideEnd && !overlay) {
    throw new Error(
      "BandSurface: `asideEnd` floats over the view, beside an overlay band " +
        "only — an in-flow band leaves it no room.",
    );
  }
  // The floating aside's reach from the left edge: its gutter plus its own
  // measured width. Beside an in-flow band the aside has a column of its own,
  // so the band and the body start past it already.
  const asideInset =
    overlay && hasAside
      ? `calc(${spaceLength(GUTTER)} + ${asideWidth}px)`
      : "0px";
  const bandNode = (
    <DataViewControlsProvider {...controls}>
      {band(asideInset)}
    </DataViewControlsProvider>
  );
  const asideNode = hasAside ? (
    <DataViewControlsProvider {...controls}>{aside}</DataViewControlsProvider>
  ) : null;

  if (overlay) {
    const gutter = spaceLength(GUTTER);
    // What the surface's right edge holds before a floating view card: the
    // consumer's reserved room, then the asideEnd's card and its gutter.
    const reserveRight = reserve?.right ?? "0px";
    const rightInset = hasAsideEnd
      ? `calc(${reserveRight} + ${gutter} + ${asideEndWidth}px)`
      : reserveRight;
    const view = backdrop ? (
      <>
        {/* The backdrop: the same box a full-bleed view gets, at a position
            no view switch changes. */}
        <Scroll fill isolate>
          <div className="h-full">{backdrop.node}</div>
        </Scroll>
        {backdrop.panel ? (
          // The active view's card: its own scroller, so its sticky headers
          // pin at its top (the header offset is the card's, zero).
          <Layer
            layer="nav"
            style={{
              top: `var(${DATA_VIEW_HEADER_OFFSET_VAR})`,
              left: `calc(${asideInset} + ${gutter})`,
              right: `calc(${rightInset} + ${gutter})`,
              bottom: gutter,
            }}
          >
            <Surface level="overlay" as={Clip} className="h-full">
              <Stack
                gap="none"
                className="h-full"
                style={
                  { [DATA_VIEW_HEADER_OFFSET_VAR]: "0px" } as CSSProperties
                }
              >
                <Scroll fill>{children}</Scroll>
              </Stack>
            </Surface>
          </Layer>
        ) : null}
      </>
    ) : null;
    const bodyStyle: CSSProperties | undefined = fullBleed
      ? undefined
      : {
          paddingTop: `var(${DATA_VIEW_HEADER_OFFSET_VAR})`,
          paddingLeft: asideInset,
        };
    return (
      <>
        {/* The surface's one scroller (the root fills its parent, so the pane
            no longer scrolls the view). `isolate`: whatever stacking a view
            opens (a map's layers) stays under the floating band and aside. */}
        {view ?? (
          <Scroll fill isolate>
            <div
              className={fullBleed ? "h-full" : "min-h-full"}
              style={bodyStyle}
            >
              {children}
            </div>
          </Scroll>
        )}
        {bandNode}
        {asideNode ? (
          // The pin spans the surface's height (less the gutters) but is
          // click-through: the card inside hugs its aside's own height, capped
          // at the pin's, so an aside that folds to its header (the Places tag
          // sidebar) leaves the view below it reachable.
          <Pin
            to="left"
            stretch
            offset={GUTTER}
            spanOffset={GUTTER}
            layer="nav"
            decorative
            ref={asideRef}
          >
            {/* The card is a flex item of the pin's full-height column: it is
                its content's height, yielding (down to the pin's height) when
                the content is taller. Its post-flex height is definite (the
                column's is), so the aside's column inside fills exactly it. */}
            <Stack gap="none" className="h-full">
              {/* `overlay`: the floating-panel role (its own corners, ring and
                  shadow), the same material as the band's floating cards. */}
              <Surface level="overlay" className={yieldClass("y")}>
                <Stack gap="none" as={OverlayInteractive} className="h-full">
                  {asideNode}
                </Stack>
              </Surface>
            </Stack>
          </Pin>
        ) : null}
        {hasAsideEnd ? (
          // The aside's mirror on the right, but below the band (the tools
          // card holds the top-right corner): a click-through column from
          // the band's foot to a gutter above the bottom, a gutter in from
          // the reserved room, as wide as its card — which hugs its panel's
          // height, capped at the column's.
          <Layer
            layer="nav"
            decorative
            ref={asideEndRef}
            style={{
              top: `var(${DATA_VIEW_HEADER_OFFSET_VAR})`,
              right: `calc(${reserveRight} + ${gutter})`,
              bottom: gutter,
              left: "auto",
            }}
          >
            <Stack gap="none" className="h-full">
              <Surface level="overlay" className={yieldClass("y")}>
                <Stack gap="none" as={OverlayInteractive} className="h-full">
                  <DataViewControlsProvider {...controls}>
                    {asideEnd}
                  </DataViewControlsProvider>
                </Stack>
              </Surface>
            </Stack>
          </Layer>
        ) : null}
      </>
    );
  }

  if (!asideNode) {
    return measureStyle === undefined ? (
      <>
        {bandNode}
        {children}
      </>
    ) : (
      <Stack gap="none" style={measureStyle}>
        {bandNode}
        {children}
      </Stack>
    );
  }

  return (
    <Stack direction="row" gap="none" align="start">
      <Sticky
        edge="top"
        ref={setAsideColumn}
        className={rigidClass()}
        style={viewportHeight === null ? undefined : { height: viewportHeight }}
      >
        <Stack gap="none" className="h-full">
          {asideNode}
        </Stack>
      </Sticky>
      <Stack gap="none" className={fillClasses("x")} style={measureStyle}>
        {bandNode}
        {children}
      </Stack>
    </Stack>
  );
}
