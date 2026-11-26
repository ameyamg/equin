import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { ConfigV2 } from "@plugins/config_v2/server";
import { recorderConfig } from "../core";
import { recorderSavesRetention } from "./internal/retention";

export { _recorderSaves } from "./internal/tables";

export default {
  description:
    "The tab recorder, every host's half: registers the Recordings folder setting (Settings → Config), which the machine half writes recordings into, and owns the recorder_saves table (each recording's save outcome, by id — kept a week).",
  contributions: [ConfigV2.Register({ descriptor: recorderConfig })],
  register: [recorderSavesRetention],
} satisfies ServerPluginDefinition;
