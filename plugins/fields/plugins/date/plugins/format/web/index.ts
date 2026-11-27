import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { ConfigV2 } from "@plugins/config_v2/web";
import { dateFormatConfig } from "../core";

export { useDateFormatter } from "./use-date-formatter";

export default {
  description:
    "Registers the Clock / Date order / Numeric dates config and reads it live as useDateFormatter() — the formatter every surface writes a date or a time with.",
  contributions: [ConfigV2.WebRegister({ descriptor: dateFormatConfig })],
} satisfies PluginDefinition;
