import { fieldSample } from "@plugins/config_v2/plugins/fields/core";
import { formattedTextField } from "./formatted-text";

/** The formatted-text field's fixed gallery sample (see `FieldSample`). */
export const formattedTextSample = fieldSample(
  formattedTextField({
    label: "Tip",
    description: "Shown on the tips page.",
  }),
  "Use <kbd>⌘</kbd>+Click to open a link in a **side pane**.\nSee [the tips](/about/tips).",
);
