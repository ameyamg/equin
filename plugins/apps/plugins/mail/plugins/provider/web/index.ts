import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { MailProviderUi } from "./slots";

export { MailProviderUi, type MailProviderConnectContribution } from "./slots";

export default {
  description:
    "Mail providers, web half: the MailProviderUi.Connect slot — each provider kind's connect surface, drawn in place of a mail list its account cannot answer (not connected).",
  contributions: [],
  slots: MailProviderUi,
} satisfies PluginDefinition;
