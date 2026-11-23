import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";

export { generatesBox } from "./internal/generates-box";

export default {
  description:
    'Whether an element generates a box at all: generatesBox(el) — false when it left the document, is display: contents, or sits under display: none; visibility: hidden and a 0×0 box still count. The one layout read behind every "is this anchor / cell / child drawn?" question (a popover\'s anchor-lost rule, the adaptive bar, the rail guard), so a host without a layout engine (jsdom, which answers getClientRects() with [] for every element) declares itself once and is answered from computed display. Its lint rule (no-raw-box-presence) sends every other getClientRects().length read here.',
  contributions: [],
} satisfies PluginDefinition;
