import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { JsonlViewerTool } from "@plugins/conversations/plugins/conversation-view/plugins/jsonl-viewer/plugins/tool-call/web";
import { ReadPageInputSchema, ReadPageView } from "./components/read-page-view";

export default {
  description:
    "Renders read_page MCP tool calls: the page the read was scoped to as a clickable chip, and the markdown it returned.",
  contributions: [
    JsonlViewerTool.Renderer({
      // Namespaced: the Claude-in-Chrome extension also has a `read_page`
      // (ref / filter inputs, no block), which this card's schema rightly rejects.
      match: /^mcp__equin__read_page$/,
      icon: symbol("article"),
      input: ReadPageInputSchema,
      component: ReadPageView,
    }),
  ],
} satisfies PluginDefinition;
