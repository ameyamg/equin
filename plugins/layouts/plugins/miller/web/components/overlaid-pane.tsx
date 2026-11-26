import { useLayoutEffect, useMemo, useRef } from "react";
import { prefersReducedMotion } from "@plugins/primitives/plugins/css/plugins/motion/web";
import { layerClasses } from "@plugins/primitives/plugins/css/plugins/layer/web";
import { cn } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { PluginErrorBoundary } from "@plugins/primitives/plugins/error-boundary/web";
import {
  PaneBox,
  PaneInstance,
  PaneLayoutContext,
  paneOwnerFor,
  type MatchEntry,
} from "@plugins/primitives/plugins/pane/web";
import { UiRegion } from "@plugins/primitives/plugins/ui-context/web";
import { MOTION_EASING_CSS, MOTION_MS } from "../layout";

/** The leaf as a layer over the column before it (`chrome.overlayBelow`). */
export interface Overlaid {
  entry: MatchEntry;
  /** Its place in the route, for the lineage label. */
  index: number;
  count: number;
}

/**
 * A pane drawn OVER the column before it rather than beside it — the route's
 * leaf, when its pane declares `chrome.overlayBelow` and the row is narrower
 * than that. Rendered inside that column's box (the containing block), so its
 * left edge can be the column's own `anchor-pane-overlay-start` box (a sidebar
 * it leaves in view) and it scrolls with the column, never with the row. The
 * layer is click-through: the pane marks its own surface interactive, so what
 * it leaves bare shows the column underneath and takes no click.
 *
 * It enters as the prototype's reader does (`.pane.enter`): a 16px slide in
 * from the right while fading in, on the row's motion curve. It leaves at
 * once — the column under it is already whole.
 */
export function OverlaidPane({ overlaid }: { overlaid: Overlaid }) {
  const { entry, index, count } = overlaid;
  const paneLayout = useMemo(
    () => ({
      // Nothing to zoom into: the layer already covers its column.
      onDoubleClickHeader: () => {},
      atSurfaceStart: false,
      atSurfaceEnd: true,
    }),
    [],
  );
  const ref = useRef<HTMLElement>(null);
  const uuid = entry.uuid;
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    el.animate(
      prefersReducedMotion()
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: "translateX(16px)" },
            { opacity: 1, transform: "none" },
          ],
      { duration: MOTION_MS, easing: MOTION_EASING_CSS },
    );
  }, [uuid]);
  return (
    <PaneInstance entry={entry}>
      <UiRegion
        kind="pane"
        id={entry.pane.id}
        label={`column ${index + 1} of ${count}, over column ${index}`}
        pluginId={paneOwnerFor(entry.pane)}
      >
        <PluginErrorBoundary slot="layouts.miller" label={entry.pane.id}>
          <PaneLayoutContext.Provider value={paneLayout}>
            <PaneBox
              ref={ref}
              pane={entry.pane}
              params={entry.params}
              // The layer: the column's full height, from its overlay-start
              // anchor's right edge (else its left edge) to its right edge,
              // on the column's `nav` layer — above its sticky chrome (the same
              // layer, later in the tree) and below its floats (a selection
              // bar: the prototype's `.selbar` over the `.pane`) — click-through,
              // and unpainted: the pane box's canvas would hide the column
              // under what the pane leaves bare, so only the pane's own
              // surfaces paint.
              // eslint-disable-next-line layout/no-adhoc-layout -- the overlay layer is the pane's flex-col clip body, like a column's
              className={cn(
                layerClasses({ layer: "nav", decorative: true }),
                "pane-overlay-start flex flex-col overflow-hidden bg-transparent",
              )}
            />
          </PaneLayoutContext.Provider>
        </PluginErrorBoundary>
      </UiRegion>
    </PaneInstance>
  );
}
