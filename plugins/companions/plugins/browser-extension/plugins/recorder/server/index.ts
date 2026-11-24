import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { ConfigV2 } from "@plugins/config_v2/server";
import { recorderConfig } from "../core";

export default {
  description:
    "The tab recorder, every host's half: registers the Recordings folder setting (Settings → Config), which the machine half writes recordings into.",
  contributions: [ConfigV2.Register({ descriptor: recorderConfig })],
} satisfies ServerPluginDefinition;
