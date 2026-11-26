import { z } from "zod";

/** What the public path is probed at: visitor-accessible, 114 B, no JS. */
export const PUBLIC_PATH_PROBE_PATH = "/api/health";

/**
 * Consecutive counted misses after which the public path is DOWN (the row
 * turns critical and a report is filed). At one probe a minute that is ~3
 * min — the link's own critical bound (2 min grace + its 45 s watchdog), so
 * both halves of the row turn critical on the same time scale; a single miss
 * is a Cloudflare blip or a network flicker a visitor's reload fixes.
 */
export const PUBLIC_PATH_DOWN_MISSES = 3;

/**
 * How long a failing record stays one outage without a probe: past it (main
 * stopped, this computer slept) the next miss starts a new outage — misses
 * are CONSECUTIVE probes, and a gap of minutes is no probe at all. Two and a
 * half probe intervals, so one late tick does not split an outage.
 */
export const PUBLIC_PATH_GAP_MS = 150_000;

/**
 * Why a probe of the public URL failed, by who answered:
 *
 * - `edge` — Cloudflare answered 520–527: it cannot reach the origin
 *   (Caddy, the server's firewall, the box);
 * - `proxy` — Caddy answered 502/503/504: it is up, equin behind it is not;
 * - `status` — something answered another status, or a 200 that is not
 *   equin's health answer;
 * - `no-answer` — no HTTP answer at all (DNS, TLS, connect, the probe's
 *   bound): Cloudflare or DNS — or this computer's own network.
 */
export const PublicPathFailureSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("edge"), status: z.number() }),
  z.object({ kind: z.literal("proxy"), status: z.number() }),
  z.object({
    kind: z.literal("status"),
    status: z.number(),
    detail: z.string(),
  }),
  z.object({ kind: z.literal("no-answer"), error: z.string() }),
]);
export type PublicPathFailure = z.infer<typeof PublicPathFailureSchema>;

/**
 * A probed public path, as kept: `ok` since a moment, or `failing` since its
 * first miss, `misses` the consecutive misses COUNTED (a probe that says
 * nothing about the site — during a deploy, or no answer while this computer
 * may be offline — is recorded but not counted).
 */
export const ProbedPublicPathSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ok"), since: z.number() }),
  z.object({
    kind: z.literal("failing"),
    since: z.number(),
    /** The latest probe of this outage (epoch ms): a gap past `PUBLIC_PATH_GAP_MS` ends it. */
    lastAt: z.number(),
    misses: z.number().int().nonnegative(),
    failure: PublicPathFailureSchema,
  }),
]);
export type ProbedPublicPath = z.infer<typeof ProbedPublicPathSchema>;

/**
 * A site's public path as `deploy.site-health` carries it: `unwatched` when
 * this instance does not probe it (a demo's stand-in box, a real box seen
 * from a worktree, a site without a public hostname), `pending` while it is
 * watched but not probed yet, else the last probe's record.
 */
export const PublicPathSchema = z.union([
  z.object({ kind: z.literal("unwatched") }),
  z.object({ kind: z.literal("pending") }),
  ProbedPublicPathSchema,
]);
export type PublicPath = z.infer<typeof PublicPathSchema>;
