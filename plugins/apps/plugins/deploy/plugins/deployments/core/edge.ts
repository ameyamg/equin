import { z } from "zod";

/**
 * What stands in front of a deployment's Caddy: the network edge visitors reach
 * first. A closed list both runtimes read (the deployment form, the converge
 * script), so plain data rather than a slot.
 *
 * - `direct` — visitors connect to the box itself. Caddy sees the visitor as its
 *   TCP peer and the firewall admits the world on 80/443 (TCP) and 443 (UDP, for
 *   HTTP/3).
 * - `cloudflare` — the hostnames' DNS records are proxied by Cloudflare (orange
 *   cloud). Caddy trusts `CF-Connecting-IP` from Cloudflare's published ranges
 *   only, and the firewall admits ONLY those ranges, so neither the CDN nor the
 *   header can be bypassed. TLS stays Caddy's own Let's Encrypt certificate,
 *   renewed by HTTP-01 through Cloudflare on port 80 — which is why the zone
 *   must be Full (strict) and must NOT turn on "Always Use HTTPS" (Caddy already
 *   redirects to HTTPS itself, after answering the ACME challenge).
 *
 * Declared on the deployment rather than inferred from DNS, because converge
 * acts on it before any request arrives: a box that thinks it is direct while
 * Cloudflare proxies it collapses every visitor onto a few Cloudflare addresses
 * without a single error.
 */
export const DEPLOYMENT_EDGES = ["direct", "cloudflare"] as const;
export const DeploymentEdgeSchema = z.enum(DEPLOYMENT_EDGES);
export type DeploymentEdge = z.infer<typeof DeploymentEdgeSchema>;

export const DEPLOYMENT_EDGE_OPTIONS = {
  direct: {
    label: "Direct",
    hint: "Visitors connect to the server itself.",
  },
  cloudflare: {
    label: "Cloudflare",
    hint: "Cloudflare proxies the hostnames; the server admits only Cloudflare and reads the visitor from CF-Connecting-IP.",
  },
} as const;
