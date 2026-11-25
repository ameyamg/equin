import type { ComponentType } from "react";
import { defineRenderSlot } from "@plugins/primitives/plugins/slot-render/web";

export const LiveDemo = {
  /**
   * The demo page's site bar links after its own Back to equin.ai: where a
   * visitor trying the demo goes next on the site (Download). Each renders one
   * `DemoBarLink`. Their order is the slot's reorder config.
   */
  BarLink: defineRenderSlot<{ label: string; component: ComponentType }>({
    docLabel: (p) => p.label,
  }),
};
