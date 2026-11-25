import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Apps } from "@plugins/apps-core/web";
import { ConfigV2 } from "@plugins/config_v2/web";
import { BrowserExtension } from "@plugins/companions/plugins/browser-extension/web";
import { recorderConfig, recorderRelayApp } from "../core";
import { RecordSection } from "./components/record-section";
import { RecorderRelayPage } from "./components/relay-page";

export default {
  description:
    "The browser extension's tab recorder, in the panel: the Record section (BrowserExtension.Section 'record', after Wish) — the 'Record this tab' row with the size dropdown (720p / 1080p / 1440p / 9:16 / As is, each with its video size, one this tab cannot record disabled with the reason) and its Apply button (size the window to the chosen preset now, without recording), the tab audio / mic / clicks / countdown toggles and the round Record button (⌥⇧R); the live recording card (timer, Discard, Pause, Stop); and the last recording saved, with Show in Files and Delete (to the Trash) on hover. The relay page the extension's offscreen recorder frames to upload a recording as the owner (its own unlisted app at /home/browser-extension-recorder). Registers the Recordings folder setting.",
  contributions: [
    ConfigV2.WebRegister({ descriptor: recorderConfig }),
    BrowserExtension.Section({
      id: "record",
      label: "Record",
      component: RecordSection,
    }),
    Apps.App({ app: recorderRelayApp, component: RecorderRelayPage }),
  ],
} satisfies PluginDefinition;
