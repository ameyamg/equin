import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Apps } from "@plugins/apps-core/web";
import { ConfigV2 } from "@plugins/config_v2/web";
import { BrowserExtension } from "@plugins/companions/plugins/browser-extension/web";
import { recorderConfig, recorderRelayApp } from "../core";
import { RecordSection } from "./components/record-section";
import { RecorderRelayPage } from "./components/relay-page";
import {
  DiscardUnfinishedAction,
  SaveUnfinishedAction,
  UnfinishedItemActions,
} from "./components/unfinished-list";

export default {
  description:
    "The browser extension's tab recorder, in the panel: the Record section (BrowserExtension.Section 'record', after Wish) — the 'Record this tab' row with the size dropdown (each preset named by the page size it lays the tab out at — 1280 × 720, 1920 × 1080, 2560 × 1440, 540 × 960, As is — with 720p… and the video size on this display beneath, the video always every physical pixel of the page; one this tab cannot record now stays choosable with a Too big / Zoomed badge) and its Apply button (size the window to the chosen preset now, without recording), the tab audio / mic / clicks / countdown toggles and the round Record button (⌥⇧R); the live recording card (timer, Discard, Pause, Stop); and the last recording saved, with Show in Files and Delete (to the Trash) on hover — or, when an upload stopped it, what was uploaded saved and the failure said; and Unfinished recordings (the folder's recordings never finished — a closed browser, a failed save), each with Save and Delete. The relay page the extension's offscreen recorder frames to upload a recording as the owner (its own unlisted app at /home/browser-extension-recorder). Registers the Recordings folder setting.",
  contributions: [
    ConfigV2.WebRegister({ descriptor: recorderConfig }),
    BrowserExtension.Section({
      id: "record",
      label: "Record",
      component: RecordSection,
    }),
    Apps.App({ app: recorderRelayApp, component: RecorderRelayPage }),
    UnfinishedItemActions({ id: "save", component: SaveUnfinishedAction }),
    UnfinishedItemActions({
      id: "discard",
      component: DiscardUnfinishedAction,
    }),
  ],
  slots: { itemActions: UnfinishedItemActions },
} satisfies PluginDefinition;
