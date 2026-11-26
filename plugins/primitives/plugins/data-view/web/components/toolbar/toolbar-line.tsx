import { createContext, useContext, type ReactNode } from "react";

/**
 * Whether the band around an arrangement is the floating action bar's anchor
 * (it reserves the bar's room: the surface's top bar in solo). Provided by
 * `DataViewToolbar` around the arrangement it draws; `false` anywhere else, so
 * a {@link ToolbarLine} outside a reserving band anchors nothing.
 */
export const BandAnchorsBarContext = createContext(false);

/**
 * The line of a toolbar arrangement the floating action bar sits on — for an
 * arrangement drawn on more than one line (Mail: the search line, then the
 * view's rule chips under it while a search is typed or the view is edited).
 *
 * The bar's band spans its anchor's top and height and centres the bar in it.
 * The DataView band names itself that anchor, so a band that grows a second
 * line would lower the bar to the middle of both. Wrapped in this, the line
 * names itself the anchor too, and the innermost one wins (the last anchor in
 * tree order), so the bar stays centred on this line whatever grows above or
 * under it. The band keeps reserving the bar's room: the line names the
 * anchor only (`anchor-floating-bar-line`), never the band's
 * `anchor-floating-bar-band`, which is also what marks a header that
 * reserves the room.
 *
 * Only while the band reserves the bar ({@link BandAnchorsBarContext}): a
 * DataView below a header, or nested in another, must never steal the anchor
 * from the real top bar. An arrangement drawn on one line needs none: the band
 * is its line.
 */
export function ToolbarLine({ children }: { children: ReactNode }): ReactNode {
  const anchors = useContext(BandAnchorsBarContext);
  return (
    <div className={anchors ? "anchor-floating-bar-line" : undefined}>
      {children}
    </div>
  );
}
