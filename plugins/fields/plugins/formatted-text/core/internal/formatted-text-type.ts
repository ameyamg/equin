import { defineFieldType, defineFieldIdentity } from "@plugins/fields/core";
import { multilineTextFieldType } from "@plugins/fields/plugins/multiline-text/core";
import { symbol } from "@plugins/ui/plugins/icons/core";

/** The stored value is the markup SOURCE (a string), never the parsed nodes. */
export const formattedTextFieldType = defineFieldType<string>("formatted-text");

export const formattedTextIdentity = defineFieldIdentity<string>({
  type: formattedTextFieldType,
  kind: "prose",
  label: "Formatted text",
  icon: symbol("format-bold"),
  // A table cell or filter that knows no formatted text falls back to long
  // text, then text: the source shown as written.
  extends: multilineTextFieldType,
  coerce: (v) => (typeof v === "string" ? v : String(v ?? "")),
});
