import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { MailProviderUi } from "@plugins/apps/plugins/mail/plugins/provider/web";
import { GmailConnect } from "./components/gmail-connect";

export default {
  description:
    "The Gmail provider's browser half: its connect surface for Mail (the shared Gmail access state and the control that fixes it, in place).",
  contributions: [
    MailProviderUi.Connect({ id: "gmail", component: GmailConnect }),
  ],
} satisfies PluginDefinition;
