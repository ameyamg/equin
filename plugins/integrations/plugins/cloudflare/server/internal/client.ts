import { z } from "zod";

/** Root of Cloudflare's v4 REST API. Every call here hangs off it. */
export const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

/**
 * Cloudflare's v4 envelope: `{ success, errors: [{ code, message }], result }`.
 * A refusal (`success: false`, or a non-2xx) carries its reason in `errors`,
 * which is the whole diagnosis ("Authentication error", a missing permission),
 * so it is surfaced verbatim.
 */
const EnvelopeSchema = z.object({
  success: z.boolean(),
  errors: z.array(z.object({ code: z.number(), message: z.string() })),
  result: z.unknown(),
});

/** A Cloudflare call that did not do what it was asked, in Cloudflare's words. */
export class CloudflareApiError extends Error {
  constructor(
    readonly what: string,
    readonly status: number,
    message: string,
  ) {
    super(`Cloudflare refused ${what} (HTTP ${status}): ${message}`);
    this.name = "CloudflareApiError";
  }
}

/**
 * One Cloudflare call with a bearer token, its `result` parsed with `schema`.
 *
 * Plain `fetch`: `api.cloudflare.com` is a fixed host written here, never a URL
 * a user supplied, so `safe-fetch`'s SSRF guard buys nothing. No retry: every
 * caller is a deploy step a person watches, and a visible refusal beats a
 * silent backoff.
 */
async function cloudflareCall<T>(
  token: string,
  what: string,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
  schema: z.ZodType<T>,
): Promise<T> {
  const res = await fetch(`${CLOUDFLARE_API_BASE}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }).catch((err: unknown) => {
    throw new Error(
      `Could not reach Cloudflare's API for ${what} — check this machine's internet connection. (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  });
  const raw = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    throw new CloudflareApiError(what, res.status, raw.slice(0, 300));
  }
  const envelope = EnvelopeSchema.safeParse(body);
  if (!envelope.success) {
    throw new CloudflareApiError(
      what,
      res.status,
      `an answer of an unknown shape: ${raw.slice(0, 300)}`,
    );
  }
  if (!res.ok || !envelope.data.success) {
    const reasons = envelope.data.errors
      .map((e) => `${e.message} (code ${e.code})`)
      .join("; ");
    throw new CloudflareApiError(
      what,
      res.status,
      reasons || "no reason given",
    );
  }
  const result = schema.safeParse(envelope.data.result);
  if (!result.success) {
    throw new CloudflareApiError(
      what,
      res.status,
      `a result of an unknown shape: ${result.error.message}`,
    );
  }
  return result.data;
}

const ZoneSchema = z.object({ id: z.string().min(1), name: z.string().min(1) });

/** A Cloudflare zone: the id its API calls name, and its domain. */
export type CloudflareZone = z.infer<typeof ZoneSchema>;

/**
 * Most zones one token may read in a single page. A purge token is scoped to
 * the zones it purges — a handful — so one page is the whole answer; more is
 * refused rather than half-read.
 */
const ZONES_PAGE = 50;

/** Every zone the token can read (`Zone · Zone · Read`). */
export async function listZones(token: string): Promise<CloudflareZone[]> {
  const zones = await cloudflareCall(
    token,
    "listing the token's zones",
    `/zones?per_page=${ZONES_PAGE}`,
    { method: "GET" },
    z.array(ZoneSchema),
  );
  if (zones.length >= ZONES_PAGE) {
    throw new Error(
      `This Cloudflare token can read ${ZONES_PAGE} or more zones; scope it to the zones it deploys (Zone Resources → Specific zone).`,
    );
  }
  return zones;
}

/**
 * The zone a hostname belongs to: the readable zone whose name is the
 * hostname or its longest parent domain (`www.equin.ai` → `equin.ai`). Null
 * when the token reads no such zone — the caller says what to grant.
 */
export function zoneOfHostname(
  zones: readonly CloudflareZone[],
  hostname: string,
): CloudflareZone | null {
  const host = hostname.toLowerCase();
  let best: CloudflareZone | null = null;
  for (const zone of zones) {
    const name = zone.name.toLowerCase();
    if (host !== name && !host.endsWith(`.${name}`)) continue;
    if (best === null || name.length > best.name.length) best = zone;
  }
  return best;
}

/**
 * Drop every object cached under these tags in one zone (`Cache Purge`). A
 * tag no object carries is a successful no-op, so a probe can test the
 * permission without dropping anything.
 */
export async function purgeCacheTags(
  token: string,
  zone: CloudflareZone,
  tags: readonly string[],
): Promise<void> {
  await cloudflareCall(
    token,
    `purging ${tags.join(", ")} in ${zone.name}`,
    `/zones/${encodeURIComponent(zone.id)}/purge_cache`,
    { method: "POST", body: { tags } },
    z.object({ id: z.string() }),
  );
}
