import { defineServerContribution } from "@plugins/framework/plugins/server-core/core";
import type { MailProviderDefinition } from "../../core";

/**
 * The open set of mail providers. A provider plugin contributes
 * `MailProviders.Provider(definition)`; the cache finds one by the id its
 * account row names, and never names a provider.
 */
export const MailProviders = {
  Provider: defineServerContribution<MailProviderDefinition>("mail.provider", {
    docLabel: (p) => p.label,
  }),
};

/** The registered provider with this id; throws naming the registered ones when none is. */
export function mailProviderById(id: string): MailProviderDefinition {
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
