import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Fields } from "@plugins/fields/web";
import { formattedTextIdentity } from "../core";

export { FormattedTextView } from "./components/formatted-text-view";

export default {
  description:
    "Formatted text field type: plain text with a small, safe inline markup (bold, key caps, links, line breaks). Identity (extends multiline-text, so a table shows the source as long text), and FormattedTextView — the one renderer of a formatted text's source.",
  contributions: [Fields.Identity({ identity: formattedTextIdentity })],
} satisfies PluginDefinition;
