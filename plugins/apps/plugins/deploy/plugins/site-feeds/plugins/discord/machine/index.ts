import type { MachinePluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { SyndicationTargets } from "@plugins/apps/plugins/deploy/plugins/site-feeds/plugins/syndication/server";
import { discordSyndicationTarget } from "./internal/discord-target";

export default {
  description:
    "Discord as a place site feed items are posted to, through a channel's webhook: one message per item (its title in bold, its text, its files attached), refused before sending when the text is over 2000 characters, it has more than 10 files, or the files cannot fit the server's upload limit together — a video over its share re-encoded to fit (media/ffmpeg), never a link instead; an edit replaces the message's text and files (posting anew if it was deleted), unpublishing deletes it; a rate limit or a Discord failure is retried.",
  contributions: [SyndicationTargets.Target(discordSyndicationTarget)],
} satisfies MachinePluginDefinition;
