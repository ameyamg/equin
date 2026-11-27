import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";

export { DocumentField } from "./components/document-field";
export type {
  DocumentFieldMode,
  DocumentFieldProps,
} from "./components/document-field";
export { DocumentFieldModeSwitch } from "./components/mode-switch";

export default {
  description:
    "Document field: one editable field holding several paragraphs, headings, lists, a quote, code and dividers, read and written as Pages' text format, with a Markdown | Rich switch — both faces editable, with the page editor's selection toolbar and shortcuts in each.",
  contributions: [],
} satisfies PluginDefinition;
