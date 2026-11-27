import { defineServerContribution } from "@plugins/framework/plugins/server-core/core";
import type { PgTable } from "drizzle-orm/pg-core";
import type { MailProviderDefinition } from "../../core";

/**
 * The Postgres tables a provider's own I/O reads — its connection check, its
 * lists, its reads of a thread — and why its change signal covers them. The
 * cache calls the provider inside its served loaders, so these reads land in
 * the loaders' read sets: the cache declares every registered provider's as
 * reads its own notify carries (a provider write signals its push, the cache
 * catches up and notifies), never naming a provider. Empty for a provider
 * whose truth is outside this database (Gmail's API).
 */
export interface MailProviderReads {
  readonly tables: readonly PgTable[];
  readonly reason: string;
}

/** A provider kind as the server registers it: its definition and the tables its I/O reads. */
export interface ServerMailProvider extends MailProviderDefinition {
  readonly reads: MailProviderReads;
}

/**
 * The open set of mail providers. A provider plugin contributes
 * `MailProviders.Provider(definition)`; the cache finds one by the id its
 * account row names, and never names a provider. Each declares the tables
 * its I/O reads (`reads`), so a loader reading through it is declared.
 */
export const MailProviders = {
  Provider: defineServerContribution<ServerMailProvider>("mail.provider", {
    docLabel: (p) => p.label,
  }),
};

/** The registered provider with this id; throws naming the registered ones when none is. */
export function mailProviderById(id: string): ServerMailProvider {
  const all = MailProviders.Provider.getContributions();
  const found = all.filter((p) => p.id === id);
  if (found.length > 1) {
    throw new Error(`mail: ${found.length} providers registered as "${id}"`);
  }
  if (found.length === 0) {
    throw new Error(
      `mail: no provider "${id}" is registered (registered: ${all.map((p) => p.id).join(", ") || "none"})`,
    );
  }
  return found[0]!;
}
