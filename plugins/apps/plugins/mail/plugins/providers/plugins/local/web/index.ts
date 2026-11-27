import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { MailProviderUi } from "@plugins/apps/plugins/mail/plugins/provider/web";
import { LocalMailConnect } from "./components/local-connect";

export default {
  description:
    "The local mail provider's browser half: its connect surface for Mail — there is nothing to connect, so it says the server's sentence (no local mailbox on this device) where a list or thread would be.",
  contributions: [
    MailProviderUi.Connect({ id: "local", component: LocalMailConnect }),
  ],
} satisfies PluginDefinition;
