import { defineConfig } from "@plugins/config_v2/core";
import { intField } from "@plugins/fields/plugins/int/plugins/config/core";

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
  },
});
