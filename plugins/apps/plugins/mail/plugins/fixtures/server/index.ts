import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";

export {
  writeMailFixture,
  type WriteMailFixtureOptions,
} from "./internal/write-mail";

export default {
  description:
    "Mail fixtures, server half: writeMailFixture writes a MailFixture into the local mail provider through its real write paths — the account (setAccount), each label through the provider's own mailbox writes (created level by level, coloured from its palette — never through the Mail cache, which a seed leaves empty), each message through deliver, the inbound write, threaded by In-Reply-To / References in thread order, attachments' data/ files read by the caller's readData. Derives nothing else.",
} satisfies ServerPluginDefinition;
