import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Auth } from "@plugins/auth/web";
import { MailProviderUi } from "@plugins/apps/plugins/mail/plugins/provider/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { GmailConnect } from "./components/gmail-connect";
import { GmailPushSetup } from "./internal/push-setup";
import { useGmailPushIntegrationStatus } from "./internal/use-push-status";

export default {
  description:
    "The Gmail provider's browser half: its connect surface for Mail (the shared Gmail access state and the control that fixes it, in place), and Gmail instant updates in Settings → Accounts (under Google): grant the Pub/Sub scope, turn on the Pub/Sub API in the OAuth client's project, then Enable — which creates the topic, Gmail's publisher grant, this backend's subscription and the watch — and, once on, whether it delivers and Turn off.",
  contributions: [
    MailProviderUi.Connect({
      id: "gmail",
      label: "Gmail",
      component: GmailConnect,
    }),
    Auth.Integration({
      id: "gmail-instant-updates",
      name: "Gmail instant updates",
      icon: symbol("bolt"),
      service: "Google",
      description: "New mail in Mail the moment it arrives (Pub/Sub push).",
      setup: GmailPushSetup,
      useStatus: useGmailPushIntegrationStatus,
    }),
  ],
} satisfies PluginDefinition;
