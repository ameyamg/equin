import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";

export {
  MailProviders,
  mailProviderById,
  type MailProviderReads,
  type ServerMailProvider,
} from "./internal/registry";

export default {
  description:
    "Registers mail providers: MailProviders.Provider(definition) — a provider kind's id, capabilities, its pure compileQuery and open(accountId), which answers the account's one provider in this process, and the Postgres tables its own I/O reads (reads, required: the cache declares them as its loaders' reads) — and mailProviderById, the one lookup the cache uses by the id an account names.",
} satisfies ServerPluginDefinition;
