import { symbol } from "@plugins/ui/plugins/icons/core";
import { secretField } from "@plugins/fields/plugins/secret/plugins/config/core";
import { intField } from "@plugins/fields/plugins/int/plugins/config/core";
import { defineSyndicationTarget } from "@plugins/apps/plugins/deploy/plugins/site-feeds/plugins/syndication/core";

/** Discord's upload limit per request without boosts, in MB; 50 at boost level 2, 100 at level 3. */
export const DISCORD_DEFAULT_UPLOAD_LIMIT_MB = 10;

/**
 * A Discord channel, through one of its webhooks: an item becomes one message
 * (its title in bold, its text, its files attached — a video re-encoded when
 * it is over the server's upload limit, never a link instead).
 */
export const discordTarget = defineSyndicationTarget({
  id: "discord",
  label: "Discord",
  icon: symbol("forum"),
  configFields: {
    webhookUrl: secretField({
      label: "Webhook URL",
      description:
        "The channel's webhook (Channel settings → Integrations → Webhooks → Copy Webhook URL).",
      placeholder: "https://discord.com/api/webhooks/…",
    }),
    uploadLimitMb: intField({
      label: "Upload limit (MB)",
      description:
        "What the server may upload per message: 10 without boosts, 50 at boost level 2, 100 at level 3.",
      default: DISCORD_DEFAULT_UPLOAD_LIMIT_MB,
      min: 1,
      max: 500,
    }),
  },
});
