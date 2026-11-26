import { z } from "zod";
import {
  PUBLIC_PATH_DOWN_MISSES,
  PUBLIC_PATH_PROBE_PATH,
  PublicPathFailureSchema,
  type PublicPathFailure,
} from "../core";

/** The `site-public-path` report's payload: one outage of one site's public path. */
export const PublicPathReportSchema = z.object({
  deploymentId: z.string(),
  hostname: z.string(),
  /** The first miss of the outage (epoch ms). */
  since: z.number(),
  misses: z.number(),
  failure: PublicPathFailureSchema,
  /** The SSH link's state when it was filed: `live` means the box itself is up. */
  linkState: z.string(),
});
export type PublicPathReport = z.infer<typeof PublicPathReportSchema>;

/** Where the public path broke, in one clause. */
export function describePublicFailure(failure: PublicPathFailure): string {
  switch (failure.kind) {
    case "edge":
      return `Cloudflare can't reach the server (${String(failure.status)})`;
    case "proxy":
      return `Caddy answers, but equin behind it does not (${String(failure.status)})`;
    case "status":
      return `the health check answered ${String(failure.status)}: ${failure.detail}`;
    case "no-answer":
      return `no answer (${failure.error})`;
  }
}

/** The report's one line. */
export function describePublicPathReport(d: PublicPathReport): string {
  const box =
    d.linkState === "live"
      ? "while the box answers over SSH"
      : `and the SSH link is ${d.linkState} too`;
  return `${d.hostname}: the public site is down — ${describePublicFailure(d.failure)} — ${box}`;
}

/** The report task's body. */
export function renderPublicPathReportBody(
  d: PublicPathReport,
  row: { count: number; firstSeenAt: Date; lastSeenAt: Date },
): string {
  return [
    `**${describePublicPathReport(d)}**`,
    "",
    `This computer probes \`https://${d.hostname}${PUBLIC_PATH_PROBE_PATH}\` once a minute, the way visitors reach the site (Cloudflare → Caddy → the app). ` +
      `${String(d.misses)} consecutive probes failed (the threshold is ${String(PUBLIC_PATH_DOWN_MISSES)}), the first at ${new Date(d.since).toISOString()}.`,
    "",
    "**Where it broke:**",
    "- `edge` (520–527): Cloudflare answered but cannot reach the origin — Caddy is down, the server's firewall drops Cloudflare, or the box is down.",
    "- `proxy` (502/503/504 via Caddy): Caddy is up, the gateway or app behind it does not answer.",
    "- `status`: something answered, but not equin's health check.",
    "- `no-answer`: no HTTP answer at all (DNS, TLS, Cloudflare itself). Counted only while the SSH link was live, so this computer was online.",
    "",
    `**This failure:** \`${JSON.stringify(d.failure)}\``,
    `**SSH link when filed:** ${d.linkState}${d.linkState === "live" ? " — the box itself is up: look at Caddy (\`journalctl -u caddy\`), the firewall and Cloudflare's dashboard" : " — the box is not answering SSH either: see the Deployed sites row"}`,
    "",
    `**Outages filed:** ${String(row.count)}`,
    `**First seen:** ${row.firstSeenAt.toISOString()}`,
    `**Last seen:** ${row.lastSeenAt.toISOString()}`,
    "",
    "Watched only while this computer is awake and main runs.",
  ].join("\n");
}
