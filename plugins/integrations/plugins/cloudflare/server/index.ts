import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";

export {
  CLOUDFLARE_API_BASE,
  CloudflareApiError,
  listZones,
  purgeCacheTags,
  zoneOfHostname,
  type CloudflareZone,
} from "./internal/client";

export default {
  description:
    "Stateless Cloudflare API client: listZones(token) (the zones a token can read), zoneOfHostname(zones, hostname) (the zone a hostname belongs to) and purgeCacheTags(token, zone, tags) (drop what the edge cached under a Cache-Tag), every answer's v4 envelope zod-parsed and a refusal thrown in Cloudflare's own words. Takes the token per call.",
} satisfies ServerPluginDefinition;
