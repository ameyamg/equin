import { createContext, useContext, type ReactNode } from "react";

/** Whether the tree below is drawn inside a popup's surface. */
const PopupSurfaceContext = createContext(false);

/**
 * Says that what is below is drawn inside a popup — a popover, menu, select,
 * dialog or sheet. Provided by ui-kit's popup surfaces (`OverlayPanel`, the
 * sheet), never by a feature plugin. A reload never reopens a popup, so what
 * is kept for the place a popup opens from (a pane's scroll offsets) does not
 * describe what is drawn in one.
 */
export function PopupSurface({ children }: { children: ReactNode }) {
  return (
    <PopupSurfaceContext.Provider value={true}>
      {children}
    </PopupSurfaceContext.Provider>
  );
}

/** Whether this is drawn inside a popup's surface ({@link PopupSurface}). */
export function useInPopupSurface(): boolean {
  return useContext(PopupSurfaceContext);
}
