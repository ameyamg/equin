import { defineConfig } from "@plugins/config_v2/core";
import { dirPathField } from "@plugins/fields/plugins/directory-path/plugins/config/core";

/**
 * Where the browser extension's recordings go. The recorder's other choices
 * (size, audio, pointer, countdown) are the extension's own (kept in Chrome's
 * storage), so ⌥⇧R starts with the panel's last pick without asking equin.
 */
export const recorderConfig = defineConfig({
  name: "recorder",
  fields: {
    folder: dirPathField({
      label: "Recordings folder",
      description:
        "Where a tab recorded from the browser extension is saved, as an MP4 (with its pointer track beside it).",
      default: "~/Movies/equin",
    }),
  },
});
