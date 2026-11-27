import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { ConfigV2 } from "@plugins/config_v2/server";
import { dateFormatConfig } from "../core";

export { serverDateFormatter } from "./server-date-formatter";

export default {
  description:
    "Registers the Clock / Date order / Numeric dates config and reads it on the server as serverDateFormatter().",
  contributions: [ConfigV2.Register({ descriptor: dateFormatConfig })],
} satisfies ServerPluginDefinition;
