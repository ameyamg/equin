import type { RefObject } from "react";
import { useSurfaceShortcuts } from "@plugins/primitives/plugins/shortcuts/web";
import { useMultiSelectContext } from "./multi-select-context";

/**
 * Escape clears the provider's selection — registered only while something is
 * selected, as a surface shortcut of the list's own region (`root`: the key
 * lands in it, or the pointer is over it, or it is the surface's only such
 * region). A plain key, so it yields to a focused text field; a popover or
 * dialog that handles its own Escape (preventing it) keeps it.
 */
export function useClearOnEscape(root: RefObject<Element | null>): void {
  const { state, dispatch } = useMultiSelectContext();
  useSurfaceShortcuts(
    state.isActive
      ? [
          {
            id: "multi-select.clear",
            keys: "Escape",
            label: "Clear selection",
            group: "Selection",
            region: { root, pointer: true },
            handler: () => dispatch({ type: "CLEAR_ALL" }),
          },
        ]
      : [],
  );
}
