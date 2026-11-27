import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Fields } from "@plugins/config_v2/plugins/fields/web";
import { formattedTextSample } from "../core";
import { FormattedTextRenderer } from "./components/formatted-text-renderer";

export default {
  description:
    "Formatted text field type: config-render capability (a textarea with the syntax and a live preview drawn by FormattedTextView) plus the formattedTextField factory.",
  contributions: [
    Fields.Renderer(FormattedTextRenderer),
    Fields.Sample(formattedTextSample),
  ],
} satisfies PluginDefinition;
