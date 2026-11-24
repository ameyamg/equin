import { defineApp } from "@plugins/primitives/plugins/pane/core";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { RECORDER_RELAY_PATH } from "@plugins/companions/plugins/browser-extension/core";

/**
 * The recorder's relay page: framed (hidden) by the extension's offscreen
 * document, it uploads each chunk it is handed to the endpoints below —
 * same-origin, so as the owner. Its own unlisted app, at the path the shell
 * frames (`RECORDER_RELAY_PATH`); nothing inside equin opens it.
 */
export const recorderRelayApp = defineApp({
  id: "browser-extension-recorder",
  name: "Recorder relay",
  basePath: RECORDER_RELAY_PATH,
  icon: symbol("videocam"),
  colorMode: "system",
  listed: false,
});
