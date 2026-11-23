/**
 * What a deployed site's caches must do, checked against the real answers —
 * the pure half of `./equin deploy check-edge`.
 *
 * The cache policy lives in code (the origin's `Cache-Control`, the generated
 * Caddy site block's `Cloudflare-CDN-Cache-Control`), never in a CDN dashboard.
 * This is how a drift on either side shows: a dashboard rule someone added, a
 * header a refactor dropped. Each probe fetches its URL twice; the second
 * answer is the one a CDN would have kept.
 */

/** What one URL must do at the edge. */
export type CacheExpectation =
  /** Stored at the edge: the second request is a hit (Cloudflare `HIT`). */
  | "edge-cached"
  /** Never stored at the edge: the second request is not a hit. */
  | "never-edge-cached";

export interface EdgeProbe {
  /** Path on the site, starting with `/`. */
  readonly path: string;
  readonly expect: CacheExpectation;
  /** The status the origin must answer (the probe checks it before the cache). */
  readonly status: number;
  /** Why this URL is held to this, in words — printed with a failure. */
  readonly why: string;
}

/** The headers a judgement reads, lower-cased names. */
export interface ProbeAnswer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
}

/** Which edge answered, read off the response: Cloudflare stamps `cf-ray`. */
export function answeringEdge(answer: ProbeAnswer): "cloudflare" | "direct" {
  return answer.headers["cf-ray"] !== undefined ? "cloudflare" : "direct";
}

/**
 * The first `/artifacts/…` URL the shell names — a content-addressed module
 * every build serves, so a site always has one to probe. Null when the shell
 * names none, which the caller reports as a failure of its own: a shell with
 * no module cannot boot.
 */
export function firstArtifactPath(shellHtml: string): string | null {
  const match = /["'](\/artifacts\/[^"'\s]+\.js)["']/.exec(shellHtml);
  return match?.[1] ?? null;
}

/**
 * The probes every site gets. `artifactPath` comes from the shell; `missing`
 * is an address no build ever wrote (the caller makes it unique per run so
 * no earlier run's answer can be in a cache); `extraUncached` are paths the
 * caller names that must never be stored (the site's film).
 */
export function edgeProbes(opts: {
  artifactPath: string;
  missingArtifactPath: string;
  extraUncached: readonly string[];
}): EdgeProbe[] {
  return [
    {
      path: "/",
      expect: "never-edge-cached",
      status: 200,
      why: "the HTML shell names the current build; a cached copy pins visitors to an old one",
    },
    {
      path: "/api/health",
      expect: "never-edge-cached",
      status: 200,
      why: "API answers are live (`no-store`)",
    },
    {
      path: opts.artifactPath,
      expect: "edge-cached",
      status: 200,
      why: "a content-addressed module is immutable — serving it from the edge is the point of the CDN",
    },
    {
      path: opts.missingArtifactPath,
      expect: "never-edge-cached",
      status: 404,
      why: "a missing address may exist a moment later; a cached 404 would pin it missing",
    },
    ...opts.extraUncached.map((path): EdgeProbe => ({
      path,
      expect: "never-edge-cached",
      status: 200,
      why: "named on the command line as never stored at the edge (video: Cloudflare's CDN terms)",
    })),
  ];
}

export type ProbeVerdict =
  | { readonly ok: true; readonly detail: string }
  | { readonly ok: false; readonly detail: string };

/**
 * Judge one probe from its two answers. On a `direct` edge there is no CDN, so
 * only the origin's half is checked (the status, and an edge-cached URL being
 * immutable); behind Cloudflare its `cf-cache-status` on the SECOND request is
 * the verdict — `HIT` stored, anything else (`MISS` twice, `BYPASS`,
 * `DYNAMIC`, `EXPIRED`) not.
 */
export function judgeProbe(
  probe: EdgeProbe,
  first: ProbeAnswer,
  second: ProbeAnswer,
): ProbeVerdict {
  if (first.status !== probe.status) {
    return {
      ok: false,
      detail: `answered ${first.status}, expected ${probe.status}`,
    };
  }
  const cacheControl = second.headers["cache-control"] ?? "(none)";
  if (answeringEdge(second) === "direct") {
    if (probe.expect === "edge-cached" && !cacheControl.includes("immutable")) {
      return {
        ok: false,
        detail: `no CDN in front, and the origin's Cache-Control is ${cacheControl} — a CDN could not keep it either`,
      };
    }
    return {
      ok: true,
      detail: `no CDN in front; origin Cache-Control ${cacheControl}`,
    };
  }
  const cfStatus = second.headers["cf-cache-status"] ?? "(none)";
  const hit = cfStatus === "HIT";
  if (probe.expect === "edge-cached" && !hit) {
    return {
      ok: false,
      detail: `second request was ${cfStatus}, expected HIT (origin Cache-Control ${cacheControl})`,
    };
  }
  if (probe.expect === "never-edge-cached" && hit) {
    return {
      ok: false,
      detail: `second request was a HIT — Cloudflare stored it (origin Cache-Control ${cacheControl})`,
    };
  }
  return { ok: true, detail: `cf-cache-status ${cfStatus}` };
}
