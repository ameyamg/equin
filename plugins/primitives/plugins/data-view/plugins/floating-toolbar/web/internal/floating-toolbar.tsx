import type { ReactNode } from "react";
import { spaceLength } from "@plugins/primitives/plugins/css/plugins/space-ramp/core";
import type {
  ToolbarArrangement,
  ToolbarParts,
} from "@plugins/primitives/plugins/data-view/core";
import { PillsToolbar } from "@plugins/primitives/plugins/data-view/web";

/** The gap between a pill and the surface's edges (and the aside). */
const GUTTER = "md";

/**
 * The DataView's own two-pill toolbar (`PillsToolbar`), floated over the view:
 * [title + views] top-left, past the surface's aside, and [search · controls
 * · actions | create] top-right. The band between them is the host's
 * click-through layer, so the view (a map) stays reachable around the pills;
 * each pill opts back into pointer events.
 */
function FloatingToolbar(parts: ToolbarParts): ReactNode {
  const { asideInset } = parts;

  // At the surface's top-right corner the band (the host's, around this row)
  // reserves the global floating bar's room and anchors it, so the bar is
  // centred on the band's line, level with the pills.
  const gutter = spaceLength(GUTTER);
  return (
    <PillsToolbar
      {...parts}
      overlay
      className="py-md pr-md"
      // The left pill starts one gutter past the aside's floating card.
      style={{ paddingLeft: `calc(${asideInset} + ${gutter})` }}
    />
  );
}

/** The floating arrangement — pass as `<DataView toolbar={floatingToolbar}>`. */
export const floatingToolbar: ToolbarArrangement = {
  id: "floating",
  forms: { search: "filled", controls: "ghost", creators: "labelled" },
  component: FloatingToolbar,
  overlay: true,
};
