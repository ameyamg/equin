import { asc } from "drizzle-orm";
import { db } from "@plugins/database/server";
import {
  isMain,
  runtimeNamespace,
} from "@plugins/infra/plugins/runtime-identity/core";
import { namespaceUrl } from "@plugins/infra/plugins/namespace/core";
import { servedGatewayPort } from "@plugins/infra/plugins/launcher/plugins/gateway-port/core";
import { compositionIncludesEach } from "@plugins/plugin-meta/plugins/composition/server";
import { _deployDeployments } from "@plugins/apps/plugins/deploy/plugins/deployments/server";
import { siteFeedDeclarationOf } from "@plugins/apps/plugins/deploy/plugins/site-feeds/plugins/box/server";
import type { SitePublishScope } from "../../core";
import {
  destinationsOf,
  primaryDestination,
  publishScopeOf,
  type ResolvedDestination,
} from "./destination-rules";

/** Whether this instance publishes to deployed sites (main only). */
export function publishScope(): SitePublishScope {
  return publishScopeOf(isMain());
}

/**
 * Every copy of the site serving `feedId`: each deployment whose composition
 * closure includes the feed's declaring plugin (asked of the composition
 * engine, never by name — the server twin of the web's
 * `useDeploymentShipsEach`), then this instance. Null when no plugin of this
 * app declares the feed any more.
 */
export async function siteFeedDestinations(
  feedId: string,
): Promise<ResolvedDestination[] | null> {
  const declared = siteFeedDeclarationOf(feedId);
  if (declared === null) return null;
  const deployments = await db
    .select({
      id: _deployDeployments.id,
      compositionId: _deployDeployments.compositionId,
      hostnames: _deployDeployments.hostnames,
    })
    .from(_deployDeployments)
    .orderBy(asc(_deployDeployments.createdAt), asc(_deployDeployments.id));
  const shipping = new Set<string>();
  const byComposition = new Map<string, boolean>();
  for (const d of deployments) {
    let ships = byComposition.get(d.compositionId);
    if (ships === undefined) {
      const inclusion = await compositionIncludesEach(d.compositionId, [
        declared.pluginId,
      ]);
      // A renamed or removed composition ships nothing we can know of.
      ships =
        inclusion.kind === "ready" && inclusion.included.has(declared.pluginId);
      byComposition.set(d.compositionId, ships);
    }
    if (ships) shipping.add(d.id);
  }
  const { feed } = declared;
  return destinationsOf({
    deployments,
    shipping,
    onMain: isMain(),
    pagePath: feed.pagePath,
    localUrl:
      feed.localPagePath === undefined
        ? null
        : namespaceUrl(
            runtimeNamespace(),
            feed.localPagePath,
            servedGatewayPort(),
          ),
  });
}

/**
 * The destination standing for the item's whole publication — the first
 * deployment this instance publishes to, else this instance — or null when
 * the feed is no longer declared.
 */
export async function primarySiteFeedDestination(
  feedId: string,
): Promise<ResolvedDestination | null> {
  const all = await siteFeedDestinations(feedId);
  return all === null ? null : primaryDestination(all);
}
