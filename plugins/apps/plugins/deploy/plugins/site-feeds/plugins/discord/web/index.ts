import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { SyndicationTargets } from "@plugins/apps/plugins/deploy/plugins/site-feeds/plugins/syndication/web";
import { discordTarget } from "../core";

export default {
  description:
    "Discord in a feed's Also post to section: its switch, the channel's webhook URL (a secret, shown only as set) and the server's upload limit.",
  contributions: [SyndicationTargets.Target({ target: discordTarget })],
} satisfies PluginDefinition;
