# Cloudflare in front of equin.ai

## Context

equin.ai is served straight from one Hetzner box: visitor → Caddy (auto ACME) →
gateway → backend (`curl -sI https://equin.ai` → `via: 1.1 Caddy`, no `cf-ray`).
DNS is at Namecheap (`dns1/2.registrar-servers.com`). The 2026-05-04 roadmap
already planned "Put Cloudflare in front (free tier)" — never done.

What we want: edge caching of the immutable bundles near visitors, DDoS / bot
absorption, and the origin hidden — **without** breaking the four things a proxy
silently breaks here:

1. **Client IP.** `requestClientIp` (`plugins/apps/plugins/deploy/plugins/analytics/plugins/host-only/server/internal/forwarded.ts`)
   reads the second-to-last `X-Forwarded-For` hop, written by Caddy from the TCP
   peer. Behind Cloudflare that peer is a CF edge, so every visitor collapses
   onto a few CF IPs — silently: analytics unique visitors + country
   (`analytics/collect`), contact-form rate limit (`site-messages/intake`,
   3/10 min per `ip_hash`), site-reports admission (6 batches/min per visitor).
2. **TLS renewal.** TLS-ALPN stops working once CF terminates TLS, and HTTP-01
   only keeps working if port 80 stays open to CF and CF does not redirect the
   challenge to HTTPS first.
3. **Caching.** The HTML shell must stay `no-cache` *to the browser*; `/api/*`
   is `no-store`. Content-addressed paths are cached for good; the shell is
   cached at the edge only, for minutes, and purged on every ship (changed
   2026-11-25 — see *Change after measurement* below).
4. **Origin bypass.** ufw allows 80/443 from anywhere, so the CDN (and a trusted
   `CF-Connecting-IP`) can be bypassed / spoofed unless the origin admits CF only.

Out of scope: **R2**. Installer and release binaries already ship from GitHub
Releases (`install.sh`, `plugins/installer/plugins/release-assets`), never from
the origin; nothing large needs moving. Workers / Tunnel: not used (a Host
rewrite would break `principalOf`'s public-host rule).

## Design: the deployment declares its edge

Clean primitive rather than hand edits on the box: the deployment row
(`deploy_deployments`, `plugins/apps/plugins/deploy/plugins/deployments`) gains
an `edge` field — `"direct"` (today) | `"cloudflare"`. `convergeScript`
(`plugins/framework/plugins/cli/plugins/deploy/cli/internal/converge-script.ts`)
derives everything from it, so a deployment cannot be half-converted:

| Concern | `direct` (unchanged) | `cloudflare` |
|---|---|---|
| Caddy global options | none | `servers { trusted_proxies static <CF ranges>; client_ip_headers CF-Connecting-IP }` |
| Forwarded header to gateway | Caddy default | `header_up X-Forwarded-For {client_ip}` (keeps the **two-hop** invariant `forwarded.ts` encodes; Caddy's default would append the CF edge → 3 hops → wrong IP) |
| TLS | auto ACME | unchanged: Caddy's Let's Encrypt cert, renewed by HTTP-01 **through Cloudflare** on port 80 (zone in Full (strict), "Always Use HTTPS" off — Caddy redirects itself after answering the challenge) |
| Firewall | 80,443/tcp + 443/udp from anywhere | SSH from anywhere; 80,443/tcp from CF ranges only (one ufw rule per range); 443/udp closed (CF reaches the origin over TCP). Rebuilt via `ufw --force reset` whenever the set is not exactly one rule per published range |
| Box-wide consistency | — | Caddy's global options and ufw are server-wide, so converge refuses a server whose sites disagree on `edge` |
| CF ranges | — | fetched at converge time from `https://www.cloudflare.com/ips-v4` + `ips-v6`; converge **fails loudly** on a fetch failure or an empty list (never writes an empty trust list or firewall) |

Because `X-Forwarded-For` still reaches the backend as `<visitor>, 127.0.0.1`,
**`forwarded.ts`, `isHostLocalRequest`, `hostOnly` and all three consumers stay
unchanged**. Only its doc comment gains the CF hop. Caddy's access log `client_ip`
also becomes the real visitor.

Trust is scoped: `CF-Connecting-IP` is believed only from a CF-range peer, and
the firewall makes a CF-range peer the only peer. A forged header from elsewhere
can't even connect.

### Small origin fix (both edges)

Unhashed static files (root icons, `/snapshot/*`, anything outside `/assets/`
and `/artifacts/`) currently carry **no** `Cache-Control` (`gateway/encoding.go`
`serveStaticFile`), so CF would apply heuristic freshness. The gateway sets
`Cache-Control: no-cache` on them (same rule as the shell). This is a one-line
gateway change with a test in `gateway/encoding_test.go`.

## Cloudflare dashboard config (manual, by the user — documented in the deploy plugin's CLAUDE.md)

1. Add zone `equin.ai`. Import records. Switch Namecheap nameservers to CF's.
   Records start **DNS-only (grey)**, so nothing changes yet.
2. SSL/TLS: **Full (strict)**. Always Use HTTPS on. Min TLS 1.2. Never Flexible:
   origin would see http and break canonical / sitemap origins
   (`gateway/snapshot.go`, `website/crawlable`).
3. Network: WebSockets on (default). HTTP/3 on (CF ↔ visitor).
4. Cache Rules (CF already honours origin `Cache-Control`; the rules make it explicit):
   - Bypass: `/api/*` **except** `/api/asset-mirror/*`, and `/ws/*`.
   - Eligible, respect origin: `/artifacts/*`, `/assets/*`, `/api/asset-mirror/*`.
   - HTML: default (not cached; the origin sends `no-cache`).
   - Do **not** cache 404s on `/artifacts/*`: a still-uploading/retained address must not be pinned missing.
5. Optional, free plan's one rate-limiting rule: `POST /api/site-messages/*`, as an
   edge backstop to the app limit.

**Showcase film caveat.** The ~16 MB `equin-v<N>-web.mp4` comes through
`/api/asset-mirror/website-media/…`. Cloudflare's CDN terms bar serving video
or a disproportionate share of large media from the free plan. Bypass the cache
for `*.mp4` (the origin keeps serving it, with ranges intact) unless we later
move it to Stream / R2. Defaulting to bypass keeps us compliant.

**Change from the first draft (implementation):** the first draft used a
Cloudflare Origin CA certificate delivered as two deploy secrets. Deploy secrets
are single-line `KEY=value` stdin lines (`DEPLOY_SECRET_VALUE_PATTERN`), so a
PEM cannot travel that way, and admitting port 80 from Cloudflare keeps Caddy's
own ACME working with no secret to rotate. TLS is therefore unchanged.

**Change after review (cache policy in code):** the dashboard Cache Rules are
dropped. Cloudflare follows the origin's `Cache-Control` by default, which
already says the right thing everywhere but one place, now fixed in code: a
missing `/artifacts/*` (the gateway's 404 is `no-store`). The film is cached
like any immutable asset — a user decision: it loads only on play, and
equin.ai's bytes are not mostly video, so the CDN-terms risk is negligible
(R2 / Stream is the route if that changes). `./equin
deploy check-edge` verifies the live answers, so drift on either side shows.

**Change after measurement (2026-11-25, user decision D22 = A): the HTML is
edge-cached, purged on every ship.** The rule above kept the shell `DYNAMIC`
at Cloudflare, so every page view went visitor → edge → Germany, often over
a fresh edge→origin connection — slower than the direct box it replaced.
Visitor first-byte medians, Nov 20–22 (direct) → Nov 23–24 (Cloudflare,
`DYNAMIC` HTML): Europe 116 → ~200 ms (server wait 35–40 → 110–130 ms), North
America 357–397 → 419–524 ms, rest of the world's share over 1.5 s 1.7–4.2% →
14.5–16.7%; a cold first byte from Paris 90–150 ms against ~22 ms direct
(task-1795143634-3rjo91). The rule existed because a stored shell names an old
build; a purge on every activation removes that reason, so:

- The browser still gets `Cache-Control: no-cache` (it revalidates, now
  against the edge). Cloudflare alone reads `Cloudflare-CDN-Cache-Control:
  max-age=600, stale-while-revalidate=3600` and `Cache-Tag:
  equin-documents-<composition>`, which the generated site block adds to
  200/304 answers the origin marks `no-cache`, outside `/api/*` and `/ws/*`,
  on a `cloudflare` edge only.
- `deploy ship` and `deploy converge` purge that tag after their scripts (a passed or failed gate alike),
  through the Cloudflare account in Settings → Accounts (`auth/cloudflare`,
  token: Zone Read + Cache Purge). Converge and ship refuse a `cloudflare`
  edge without a token that reads each hostname's zone, so the cache cannot
  exist without its purge.
- The TTL bounds only what changes without a ship (the theme's head the
  backend renders) and a failed purge; max-age + stale stays well inside the
  day web-artifacts keeps every served address.
- Nothing in the shell is per visitor: same bytes per path and build (head,
  framing policy, snapshot keyed by path), no cookie set or read, the cache
  key holds host and query. Cloudflare's email obfuscation rewrites the body
  after the cache, per response.
- Cloudflare never caches HTML by itself, so the zone gets ONE cache rule
  that carries no policy: everything outside `/api/*` and `/ws/*` eligible,
  edge TTL from the origin's headers, bypass when absent
  (`framework/cli/deploy` CLAUDE.md, checklist step 3).
- `deploy check-edge` now expects `/` to be a `HIT` that is `no-cache` to
  the browser.

## Rollout order (each step reversible)

1. **Code lands with `edge: "direct"`** for equin.ai. This is a no-op converge: Caddyfile, firewall and TLS are byte-identical, which a test asserts.
2. **DNS to Cloudflare, grey cloud.** Verify the site, mail records and ACME still work.
3. **Orange cloud, edge still `direct`.** CF reaches the origin over Caddy's
   Let's Encrypt cert, so Full (strict) holds. Visitors are briefly collapsed
   onto CF IPs during this step, so keep it to minutes.
4. **Set `edge: "cloudflare"` (site → Settings → General) and converge.** Caddy
   trusts `CF-Connecting-IP` from CF only, and the firewall admits CF only.
5. Verify (below). **Rollback:** grey cloud, then `edge: "direct"` and converge
   (in that order, so the origin is reachable before the firewall reopens).

## Files

- `plugins/apps/plugins/deploy/plugins/deployments/…`: the `edge` column in `schema.ts` (migration by `./equin build`), its zod/type, and the deployment form/list field.
- `plugins/framework/plugins/cli/plugins/deploy/cli/internal/converge-script.ts`:
  - `caddySite(…, edge)`: the `tls` + `header_up` lines.
  - Root-Caddyfile writer: the global `servers` block.
  - Firewall step (§7): CF-range rules (ufw has no set-based multi-source rule, so one rule per range; the "[=] already applied" read compares the full set, and stale ranges get deleted).
  - CF range fetch with loud failure.
- `…/converge-script.test.ts`: `direct` output unchanged; `cloudflare` output contains trusted proxies, `{client_ip}`, `tls` and the CF-only firewall; an empty range list throws.
- `…/host-only/server/internal/forwarded.ts`: doc comment only (chain now `visitor → CF → Caddy → gateway`); add a test for the three-hop "CF wrote XFF, Caddy replaced it" case if one is cheap.
- `gateway/encoding.go` + test: `no-cache` on unhashed statics.
- `plugins/framework/plugins/cli/plugins/deploy/CLAUDE.md`: the edge field and the dashboard checklist above.

## Verification

- `./equin test plugins/framework/plugins/cli/plugins/deploy` and the gateway Go tests. `./equin check`.
- After step 4, on the live site:
  - `curl -sI https://equin.ai` shows `cf-ray`, `cache-control: no-cache` and, from the second request on, `cf-cache-status: HIT` (DYNAMIC before 2026-11-25).
  - `curl -sI https://equin.ai/artifacts/<some hashed file>` twice: the second returns `cf-cache-status: HIT`.
  - `curl -sI https://equin.ai/api/…` returns `BYPASS`/`DYNAMIC` with `no-store`.
  - `curl --resolve equin.ai:443:<origin IP> https://equin.ai` from a non-CF machine fails (firewall).
  - The browser loads the site, the `/ws/notifications` socket opens (DevTools), and the film plays and seeks (Range).
  - The analytics dashboard shows varied real countries, not CF PoPs. Caddy access-log `client_ip` values are visitor IPs, not `104.16.*`/`172.64.*`.
  - Contact form: one submission succeeds, and the fourth within 10 min from the same browser is limited (the bucket is per visitor again).
