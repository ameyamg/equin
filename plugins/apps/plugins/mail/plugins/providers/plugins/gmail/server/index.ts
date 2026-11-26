import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { MailProviders } from "@plugins/apps/plugins/mail/plugins/provider/server";
import { gmailMailProvider } from "./internal/definition";

export default {
  description:
    "Registers the Gmail mail provider: MailProvider over integrations/gmail/api, one client and quota pacer per account, Gmail's q compiled from the contract's filter.",
  contributions: [MailProviders.Provider(gmailMailProvider)],
} satisfies ServerPluginDefinition;
