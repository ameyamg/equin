# Deployed sites: probe the public path through Cloudflare

Task task-1795696483-wtw3vc (decision D21, dec-1795652372-o11mx0, option A).

## Context

The health report's *Deployed sites* row only sees the box over the SSH
tunnel (`box-link/link`). Cloudflare answered equin.ai's visitors 522 at least
three times (11-23 17:49, 11-24 17:02 and 21:22 UTC) and 520 once
(report-1795457134-or3rra) while the row stayed green: SSH worked, the public
path (Cloudflare → Caddy → gateway → app) did not. We only know because two
stale tabs ran pre-beacon code; durations and visitors hit are unknown.

## What the user sees

```
equin.ai                       ● Public site down since 7:01 PM
  Public site: Cloudflare can't reach the server (522)
  the box answers SSH — Caddy or the server's firewall is not letting Cloudflare in
```

and a `site-public-path` report once the outage is sustained.

## Design

**One probe, scheduled.** `deploy.box-link.public-probe`, a `defineJob`
(`cron: * * * * *`, main only, `dedup: singleton`, `hold: seconds`). Polling is
the documented exception: a site that does not answer sends no change signal.
For each deployment this instance links over SSH (real boxes — never a demo's
stand-in, never from a worktree) with a public hostname, it GETs
`https://<hostname>/api/health` (visitor-accessible; 114 B; ~90–140 ms from
this Mac; 30 s bound — Cloudflare's own 522 takes ~15–19 s to come back).

**Not a visitor.** Site analytics count only the tracker's JS beacons (`POST
/api/analytics/collect`); visitor reports are filed by browser JS too. A server
GET of `/api/health` runs no JS, so it counts nowhere and files nothing on the
box.

**Classifying the answer** (pure, `link/shared/public-probe.ts`):

| Answer | Failure kind | Where it broke |
|---|---|---|
| 200 + a health body | — (ok) | |
| 520–527 | `edge` | Cloudflare can't reach the origin: Caddy, the firewall, the box |
| 502/503/504 with `via: … Caddy` | `proxy` | Caddy is up, equin behind it is not |
| any other status / a 200 that is not a health answer | `status` | something answered wrongly |
| no HTTP answer (DNS, TLS, connect, 30 s) | `no-answer` | Cloudflare / DNS — or this computer's network |

**Counting misses, on evidence.** A failed probe counts toward the report
only when it says something about the site, not about this computer:

- a deploy run of the deployment is active at either end of the probe → not counted (restarts are expected);
- an HTTP answer (any status) → counted: something on the internet answered;
- no answer → counted only while the link is `live` (SSH proves this computer
  is online); otherwise it may be our own network (or a wake).

Misses are consecutive probes: a failing record keeps `lastAt`, and a gap past
2.5 intervals (main stopped, the Mac slept) starts a new outage.

**Threshold: 3 consecutive counted misses (~3 min).** It matches the link's
own critical bound (2 min grace + the 45 s watchdog), so both halves of the row
turn critical on the same time scale; one miss is a Cloudflare blip or a
network flicker a visitor's reload fixes. Filed once per outage (the report's
count is the number of outages), fingerprint per deployment.

**State** `PublicPath` (in `SiteHealth.publicPath`):
`unwatched` (this instance does not probe it) · `pending` (watched, never
probed) · `ok { since }` · `failing { since, lastAt, misses, failure }`. In memory,
persisted to `deploy_deployments_ext_public_path` on a change only (ok → ok
writes nothing), read back at boot so a main restart mid-outage keeps its miss
count. `deploy.site-health` is notified on a change only.

**The row** (`site-row/status.ts`): only while the link is live and a miss has counted; the link state still wins (a box that does
not answer SSH reads as that); then a deploy in progress; then a failing public
path while the box answers — `attention` (transitioning) below the threshold,
`critical` from it — with an alert saying where it broke.

**Known limit.** It runs on the Mac: it watches only while the Mac is awake
and main runs. Documented in the row's and link's CLAUDE.md.

## Verification

- Unit tests: the classifier, the reducer (counting rules, threshold crossing),
  the row status/alert.
- Exhibits `site-row/public-failing` and `site-row/public-down`, shot on this
  build; `site-row/live` for the success line.
- The probe function run against equin.ai (ok) and a failing URL.
