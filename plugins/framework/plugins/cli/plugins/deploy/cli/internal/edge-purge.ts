/**
 * The purge half of a `cloudflare` edge's document cache. Converge's site
 * block lets Cloudflare keep the HTML ({@link edgeDocumentCacheTag}); this is
 * what drops it again after every activation, so a visitor never reads the
 * previous release's pages once a ship is done.
 *
 * Resolved BEFORE any host mutation by both verbs — converge (which turns the
 * cache on) and ship (which must purge it) — so a missing or under-permitted
 * token is a refusal naming the exact fix, never a site caching HTML that no
 * deploy can purge.
 */
import { getToken } from "@plugins/auth/core";
import {
  CLOUDFLARE_PROVIDER_ID,
  CLOUDFLARE_TOKEN_PERMISSIONS,
} from "@plugins/auth/plugins/cloudflare/core";
import { callEndpoint } from "@plugins/infra/plugins/endpoints/server";
import {
  CloudflareApiError,
  listZones,
  purgeCacheTags,
  zoneOfHostname,
  type CloudflareZone,
} from "@plugins/integrations/plugins/cloudflare/server";
import {
  EDGE_DOCUMENT_MAX_AGE_SEC,
  edgeDocumentCacheTag,
} from "./converge-script";
import { refuse, toBackend, type DeployTarget } from "./target";

/** What a deployment's edge purge acts on: its token, zones and tag. */
export interface EdgePurge {
  readonly zones: readonly CloudflareZone[];
  readonly tag: string;
  /** Drop every edge-cached document of this deployment, in every zone. */
  purge(): Promise<void>;
}

/**
 * A tag no response is ever cached under: purging it drops nothing, so it
 * proves the token may purge a zone before the host is touched.
 */
const PROBE_TAG = "equin-purge-probe";

const SET_UP =
  `Connect Cloudflare in Settings → Accounts → Cloudflare: a Custom Token with ` +
  `${CLOUDFLARE_TOKEN_PERMISSIONS.join(" and ")} on the site's zone.`;

/**
 * The deployment's edge purge, or null when there is nothing to purge (a
 * `direct` edge, or no public hostname). Refuses — before anything touches the
 * host — when Cloudflare's account is not connected, its token reads no zone
 * for one of the hostnames, or may not purge one (probed with a tag nothing
 * carries).
 */
export async function resolveEdgePurge(
  target: DeployTarget,
): Promise<EdgePurge | null> {
  const { deployment, install } = target;
  if (deployment.edge === "direct" || deployment.hostnames.length === 0) {
    return null;
  }
  const token = await toBackend((origin) =>
    callEndpoint(
      getToken,
      {},
      { origin, body: { providerId: CLOUDFLARE_PROVIDER_ID } },
    ),
  );
  if (!token.ok) {
    refuse(
      `this deployment's edge is cloudflare, so Cloudflare keeps its pages and every ship must purge them — ` +
        `but ${token.needsConsent ? "no Cloudflare account is connected" : `the Cloudflare token could not be read (${token.message})`}. ${SET_UP}`,
    );
  }
  const readable = await listZones(token.accessToken).catch(
    (err: unknown) => {
      if (!(err instanceof Error)) throw err;
      return refuse(
        `reading the Cloudflare token's zones failed: ${err.message}. ${SET_UP}`,
      );
    },
  );
  const zones = new Map<string, CloudflareZone>();
  for (const hostname of deployment.hostnames) {
    const zone = zoneOfHostname(readable, hostname);
    if (zone === null) {
      refuse(
        `the Cloudflare token reads no zone for ${hostname} (it reads: ${
          readable.map((z) => z.name).join(", ") || "none"
        }). ${SET_UP}`,
      );
    }
    zones.set(zone.id, zone);
  }
  for (const zone of zones.values()) {
    await purgeCacheTags(token.accessToken, zone, [PROBE_TAG]).catch(
      (err: unknown) => {
        if (!(err instanceof CloudflareApiError)) throw err;
        refuse(
          `the Cloudflare token may not purge ${zone.name}'s cache (${err.message}). ${SET_UP}`,
        );
      },
    );
  }
  const tag = edgeDocumentCacheTag(install.compositionId);
  const accessToken = token.accessToken;
  return {
    zones: [...zones.values()],
    tag,
    async purge() {
      for (const zone of zones.values()) {
        await purgeCacheTags(accessToken, zone, [tag]);
      }
    },
  };
}

/**
 * The `afterRun` of a script that changes what the site serves (ship's
 * activation, converge's restart): purge the edge's pages once the script
 * ended, and say what to do when the session was lost before it did. A purge
 * failure is collected into `failures` for the caller to report once the
 * script's own verdict is out — never thrown here, where it would replace it.
 */
export function purgeAfterRun(
  edgePurge: EdgePurge,
  failures: string[],
): (outcome: { seenToEnd: boolean }) => Promise<void> {
  return async ({ seenToEnd }) => {
    const where = `${edgePurge.tag} in ${edgePurge.zones.map((z) => z.name).join(", ")}`;
    console.log(`  • purging the edge's pages (${where})`);
    if (!seenToEnd) {
      console.error(
        `deploy: the session ended before the script did, so it may still change the site after this purge — ` +
          `once the host has settled, run the same deploy again to purge it after the change.`,
      );
    }
    await edgePurge.purge().catch((err: unknown) => {
      if (!(err instanceof Error)) throw err;
      failures.push(err.message);
      console.error(`deploy: purging the edge failed: ${err.message}`);
    });
  };
}

/** Refuse, after a script that succeeded, when its purge did not. */
export function refuseOnPurgeFailures(failures: readonly string[]): void {
  if (failures.length === 0) return;
  refuse(
    `the change is live, but purging Cloudflare's copies of the site's pages failed: ${failures.join("; ")}\n` +
      `Until they expire (at most ${EDGE_DOCUMENT_MAX_AGE_SEC / 60} min, then one more visit each) visitors may read the previous pages. ` +
      `Fix the token (Settings → Accounts → Cloudflare) and deploy again.`,
  );
}
