import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";

export {
  Panel,
  type PanelProps,
  type PanelSectionProps,
  type PanelRowProps,
  type PanelFullProps,
  type PanelStripProps,
  type PanelStateProps,
} from "./internal/panel";

export default {
  description:
    "Experimental, no consumer yet (research/2026-11-27-global-surface-parts.md): surface parts on named lines. <Panel header search footer> is the body of a floating or docked surface whose regions are grids with three named column lines (edge, fill, text); its closed parts (Panel.Section, Row, Rule, Full, Strip, State) each sit on one line, take no className and no padding prop, and nest without adding an inset — no part pads inline and none has a negative margin.",
  contributions: [],
} satisfies PluginDefinition;
