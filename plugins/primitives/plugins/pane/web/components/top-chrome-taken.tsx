import { useContext, useMemo, type ReactNode } from "react";
import { SurfaceChromeContext } from "../surface-chrome-context";

/**
 * Below here the surface's top chrome is taken: a bar above `children` is the
 * surface's top edge, so no bar inside them is (`useReservesFloatingBar` reads
 * `false` there). Worn by every bar that can be that edge, around what it sits
 * on top of: a pane header (`PaneChrome`) around its body, a DataView around
 * its band's surface (rows, aside, a nested DataView).
 *
 * So the one bar that reserves the global floating bar's safe area is the
 * first one down the tree, whichever primitive draws it — and a bar further
 * down never names itself the floating bar's anchor too (the last visible
 * anchor wins, which would pull the bar off the top edge).
 */
export function TopChromeTaken({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const outer = useContext(SurfaceChromeContext);
  const value = useMemo(
    () =>
      outer.contentOwnsTopChrome
        ? { ...outer, contentOwnsTopChrome: false }
        : outer,
    [outer],
  );
  return (
    <SurfaceChromeContext.Provider value={value}>
      {children}
    </SurfaceChromeContext.Provider>
  );
}
