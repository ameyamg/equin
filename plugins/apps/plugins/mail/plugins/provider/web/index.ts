import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { MailProviderUi } from "./slots";

export { MailProviderUi, type MailProviderConnectContribution } from "./slots";
export { MailProviderConnect } from "./components/provider-connect";

export default {
  description:
    "Mail providers, web half: the MailProviderUi.Connect slot — each provider kind's connect surface, drawn in place of a mail list or thread its account cannot answer (not connected) — MailProviderConnect renders the registered one.",
  contributions: [],
  slots: MailProviderUi,
} satisfies PluginDefinition;
