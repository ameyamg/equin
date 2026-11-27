import { defineConfig } from "@plugins/config_v2/core";
import { intField } from "@plugins/fields/plugins/int/plugins/config/core";
import { enumField } from "@plugins/fields/plugins/enum/plugins/config/core";

// Compose's settings (Settings → Config, `mail-compose`). The undo-send delay
// is the user's call (10 s, configurable); read per send on the server.
export const mailComposeConfig = defineConfig({
  name: "mail-compose",
  fields: {
    undoSendSeconds: intField({
      default: 10,
      min: 0,
      max: 30,
      label: "Undo send (seconds)",
      description:
        "How long a message you send waits in the outbox before it goes, so Undo can still take it back to the draft. 0 sends at once (no Undo).",
    }),
    editorView: enumField({
      label: "Editor view",
      description:
        "How the message you write is shown: Markdown (its text, the formatting marks dimmed) or Rich (formatted). Both edit the same text; the switch under every editor changes it, and the last choice is kept.",
      options: [
        { value: "markdown", label: "Markdown" },
        { value: "rich", label: "Rich" },
      ],
      default: "markdown",
    }),
  },
});
