import { MailProviders } from "@plugins/apps/plugins/mail/plugins/provider/server";
import {
  _mailAccounts,
  _mailMailboxes,
  _mailQueries,
  _mailQueryMembers,
  _mailThreadBodies,
  _mailThreads,
} from "./tables";

/**
 * What every Mail value served through the cache reads (its `reads` thunk:
 * `mail.threads`, `mail.mailboxes`, the reader's `mail.thread` and inline
 * images): the cache's own tables, and the tables each REGISTERED provider
 * declares its own I/O reads (`ServerMailProvider.reads`). The loaders call
 * the provider (the connection check, a fill, a thread's content), so its
 * tables are in their read sets; the cache never names a provider, so they
 * come from the registry — a thunk, read once contributions are collected
 * (network/live binds it at `bindDeferredResources`).
 *
 * All of them are `notified`, never routed: the cache writes its tables only
 * while answering or catching up and notifies what it serves itself, and a
 * provider's writes reach the cache through that provider's change signal
 * (its push, else the cache's tick), which the cache catches up on before it
 * notifies — a change-feed route would re-read a view before the cache moved.
 */
export const mailCacheReads = () => {
  const providers = MailProviders.Provider.getContributions();
  const own = providers.filter((p) => p.reads.tables.length > 0);
  return {
    tables: [],
    reason: "the Mail cache's own tables, which only the cache writes",
    notified: {
      relations: [
        _mailAccounts,
        _mailMailboxes,
        _mailThreads,
        _mailThreadBodies,
        _mailQueries,
        _mailQueryMembers,
        ...own.flatMap((p) => p.reads.tables),
      ],
      reason: [
        "the cache writes its tables only while answering or catching up, and notifies what it serves when what they answer moved",
        ...own.map((p) => `${p.label} (${p.id}): ${p.reads.reason}`),
      ].join("; "),
    },
  };
};
