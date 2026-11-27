import { appExhibit } from "@plugins/plugin-meta/plugins/exhibits/core";

// An app exhibit: the selection toolbar's buttons are `Editor.FormatAction`
// contributions, which only the live app provides.
export default [
  appExhibit({
    id: "document-field/mail-body",
    label: "Document field (a Mail body, Markdown | Rich)",
    widths: [420, 640, 900],
    load: () => import("./internal/mail-body"),
  }),
];
