# deploy

`./equin deploy converge|ship|restart|check-edge` — the verbs over a deployment.
**converge** makes a host serve a composition; **ship** puts a bundle on it and
activates it behind a health gate; **restart** restarts the installed service
on the release `current` names and holds the same gate. Design:
`research/2026-07-29-global-composition-production-deployment.md` (D3 + D4).

The first command contributed as a **group**: `cli/index.ts` declares `deploy`
with `subcommands: [converge, ship, restart]` and no `run` of its own, and each
subcommand is an ordinary leaf reaching its own implementation through a lazy
`import()`. The declaration union makes "both runs and routes" a type error, so
a group cannot accidentally acquire a body.

```
cli/index.ts                    the group + its leaves (data only)    
cli/converge.ts                 the converge action
cli/ship.ts                     the ship action
cli/restart.ts                  the restart action
cli/check-edge.ts               the live cache check (`internal/edge-cache.ts` judges, + its test)
cli/internal/target.ts          `(composition, --server)` → everything both verbs act on
cli/internal/closure-guards.ts  converge's pre-mutation refusals
cli/internal/converge-script.ts the generated host state (+ its test)
cli/internal/secret-env.ts      the approved deploy secrets, fetched and rendered for stdin
cli/internal/activate-script.ts the generated activation (extract, swap or host restart) + health gate (+ its test)
cli/internal/restart-script.ts  the generated restart + the same health gate (+ its test)
```

**A restart is a recorded run, not a repair script.** `deploy restart` is what
the box link's `down` (the server answers SSH, equin does not run) offers as
*Restart site*: `systemctl restart` of the unit, then the ship's gate —
ready, `/api/health` naming the run id of the release `current` points at,
and that process settling (`SETTLE_GATE_SH`, shared). It converges and ships
nothing, so it has nothing to revert: a release that will not come back fails
the run with the unit's journal, and the next move is a deploy. The Deploy app
launches it as the `restart` verb (`apps/deploy/deployments`), so it lands in
the site's history like a converge or a ship.

`target.ts` is what the two verbs share, and it is not a grab-bag: both must
resolve a target the SAME way, because every refusal in it is one a half-done
deploy would otherwise discover on the host. The budgets live there together —
each bounds a different external wait, and `ACTIVATE_MS` has to exceed the
health gate's own `READY_ATTEMPTS × READY_INTERVAL_SEC` plus `SETTLE_DEADLINE_SEC`,
which is only checkable by eye if all are in one place.

**A release is live once the process that took over reports its boot settled**
(`SETTLE_GATE_SH`), not on its first ready answer — the same definition as a
local build (`build/cli/internal/stay-up.ts`). Readiness is the barrier BEFORE
the post-ready boot phases, so a release that crashes in `onReady` answers once
and is respawned: another `startedAt` answering, or no answer for the last
`SETTLE_SILENCE_SEC` when the deadline passes,
fails the gate and reverts; the same process still unsettled at the deadline
passes with a `[warn] staying up is unproven` line.

**Deploy secrets travel only on stdin.** Converge asks this checkout's backend for
the deployment's approved env (refusing, before any host mutation, while a secret is
missing, new or changed — `apps/deploy/deploy-secrets`), generates the script from the
KEYS alone, and hands the `KEY=value` lines to `runScript`'s `stdin`; the script reads
them first thing (`SECRET_ENV_SH`) and encrypts each into a systemd credential
(`SECRET_CREDENTIALS_SH`) — never into the env file. No value is in argv, the
uploaded script or the transcript. Ship's health gate then asks the running app
whether it can read every installed credential, and fails the ship if not
(`apps/deploy/deploy-secrets` CLAUDE.md, *On the box*).

**A ship swaps the backend; it restarts the host only when the host changes.**
The activate script extracts the bundle while the previous release serves, then
runs the new release's `launch swap` (`infra/launcher` § A release host): the
gateway boots the new backend beside the serving one and switches once it is
ready, so no visitor waits and the old backend drains its in-flight requests.
`current` flips after the gate passes. A release whose only host difference is
the gateway binary hands the running gateway over to its own first (`[gateway
handover]`: the gateway's keeper keeps the sockets and the backend — no request
waits), then swaps the backend. A release that changes the rest of the host
(Postgres, PgBouncer, the gateway's flags, how they start) exits 3 and gets
the old path, announced as `[host restart]`: flip, `systemctl restart`, gate — already
extracted, so the gap is ~2 s rather than the ~6 s an extract-after-stop cost.
A failed swap changes nothing; a swapped release failing the gate is swapped
back to the previous release's extraction (`<release>/extract-dir`), falling
back to a host restart on it. Extractions no process of the unit runs from are
pruned after the gate — safe for open tabs, because a release is served from
a dist of its own in the data root, never from its extraction: the release's
`launch` prepares it before its backend boots, beside one address dir that
keeps every address a tab used within a day (web-artifacts'
`served-addresses`). Design:
`research/2026-11-14-global-zero-wait-site-deploys.md`.

**Every request the edge sees is logged, bounded.** Caddy writes one JSON line
per request (protocol, status, size, full duration, client) to the install's
`edgeAccessLogPath` (`/var/log/caddy/<composition>.access.log`), rotated past
100 MB, 30 gzipped rolls, 14 days at most (`caddySite`). It is the box's only
record of what a visitor's browser asked for and when it cancelled; Caddy's
journal keeps only the responses it could not finish. Converge creates the file
caddy-owned before `caddy validate` (root) can create it root-owned, which
fails the reload with "permission denied".

**The edge: direct, or behind Cloudflare.** A deployment's `edge`
(`apps/deploy/deployments` `core/edge.ts`) is what visitors reach first, and
converge derives the box from it. `direct` is the original shape: Caddy sees
the visitor, the world may reach 80/443 (TCP) and 443 (UDP). `cloudflare`
means the hostnames' DNS records are proxied by Cloudflare:

- Converge reads Cloudflare's published ranges on the box
  (`CLOUDFLARE_RANGES_SH`) before any write, and stops on a failed read, a
  token that is not a CIDR, or a list shorter than `CLOUDFLARE_MIN_RANGES`.
- The root Caddyfile trusts those ranges only and reads the client from
  `CF-Connecting-IP`; the site block sets `X-Forwarded-For` to `{client_ip}`,
  so the backend still receives `<visitor>, 127.0.0.1` and
  `requestClientIp` (analytics, contact-form limits, site-reports admission)
  names the visitor, not a Cloudflare server.
- ufw admits SSH from anywhere and 80/443 (TCP) from Cloudflare's ranges
  only, so neither the CDN nor the trusted header can be bypassed. The rule
  set is rebuilt (reset, then enable) whenever it is not exactly one rule per
  published range.
- TLS is still Caddy's Let's Encrypt certificate, renewed by HTTP-01 through
  Cloudflare on port 80.
- Both settings are server-wide, so converge refuses a server whose sites
  disagree on `edge`.

What converge cannot do — the Cloudflare zone — is a checklist, in order:

1. Add the zone and switch the registrar's nameservers to Cloudflare's, with
   every record **DNS only** (grey), so nothing changes yet.
2. SSL/TLS **Full (strict)**: never Flexible, which makes the origin see
   `http` and breaks canonical and sitemap origins. **Leave "Always Use
   HTTPS" off**: Caddy redirects to HTTPS itself after answering the ACME
   challenge, and Cloudflare redirecting first breaks HTTP-01 renewal.
   WebSockets on (the default).
3. **No Cache Rules.** The cache policy is the code's, not the dashboard's:
   Cloudflare follows the origin's `Cache-Control` (the shell `no-cache`,
   `/api/*` `no-store`, `/artifacts/*`, `/assets/*` and the asset mirror's
   files — the site's film included — immutable, a missing `/artifacts/*`
   `no-store`). A dashboard rule would be a second, unreviewed copy of that
   policy. Video is the exception a source decides: a mirrored video carries
   `CDN-Cache-Control: no-store` unless its asset-mirror source declares
   `videoAtCdn: "stored"` (`infra/asset-mirror`) — only the website's film
   does, since Cloudflare's CDN terms frown on a zone whose bytes are mostly
   video. If video ever dominates, the route is R2 / Stream.
4. Proxy the records (orange), then set the deployment's edge to
   `cloudflare` and converge. Between the two, visitors briefly read as
   Cloudflare addresses, so keep it to minutes.
5. Check it: `./equin deploy check-edge <hostname> [--uncached <path…>]`
   asks the live site, twice per URL, whether the shell and API are never
   stored at the edge, a content-addressed module is (`HIT`), a missing module
   is not pinned, and each `--uncached` path (none today) is never stored. Public requests
   only; it also passes with no CDN in front, on the origin's headers alone.
6. Rollback is the reverse order: grey records, then `direct` and converge.

Design: `research/2026-11-23-global-cloudflare-in-front-of-equin-ai.md`.

**A restart never answers a visitor with a 502.** Every restart of the unit (a
host-changing ship, converge's restart gate, a crash) closes the loopback port
until the new gateway binds. Caddy holds a request whose dial is refused for
`EDGE_RESTART_HOLD_SEC` (`caddySite`) instead of answering an empty 502 — a
refused dial never reached the install, so it is sent once, not retried; a
request cut mid-flight is re-sent only for GET. Past the bound the install is
down and the 502 is the true answer. The unit stops in order (`KillMode=mixed`,
`TimeoutStopSec=RELEASE_STOP_TIMEOUT_S`): systemd signals only the
self-extractor, which forwards to the launcher, which stops the gateway (drain,
then the backend) before Postgres. And converge restarts only when the
configuration really changed: `put` stages in the script's private `$STAGE`,
never beside its target, so a no-op converge moves no directory mtime the
restart gate reads (it used to restart the site on every deploy, through the
drop-in's `.new`).

**Every response says HTTPS only.** The site block sends
`Strict-Transport-Security: max-age=<1 year>` (`HSTS_MAX_AGE_SEC`, no
`includeSubDomains`, no `preload`) on either edge, so a returning visitor's
browser skips the `http://` → `https://` redirect. It is the code's, like the
cache policy — Cloudflare's own HSTS setting stays off.

Both generated scripts send their progress to **stderr** (`exec 1>&2`): a FAILED
`sshRun` returns stderr only, and the failing run is the one whose log matters.

<!-- AUTOGENERATED:BEGIN — do not edit; regenerated by `./equin build` -->

## Plugin reference

- Description: `./equin deploy converge|ship|restart|check-edge` — converge a host to serve a composition (run user, dirs, env, Caddy, systemd, firewall), ship release bundles to it behind a health gate, restart its installed service behind the same gate, and check a live site's caches against the code.

<!-- AUTOGENERATED:END -->
