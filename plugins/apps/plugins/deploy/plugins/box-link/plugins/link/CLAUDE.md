# box-link/link

The local half of the [box link](../../CLAUDE.md): this computer's links to
the boxes. Local only — nothing on a box imports it.

## Where it runs

- **Real boxes: main only** (one instance per user holds the real links).
  One SSH tunnel per server (`deploy.box-link.tunnel`, a `defineDaemon`
  process, `where: "main"`, backoff 2 s → 2 min, `giveUp: "never"`,
  `healthy: "ready"`), built by `infra/ssh`'s `materializeHermetic` +
  `sshTunnelArgv` with one forward per deployment on that server
  (`<scratch>/d<n>.sock` → the box gateway's loopback port). Ready = every
  socket appeared (`deploy.box-link.tunnel-sockets`, a file watcher on the
  scratch dir — ssh binds them only after it authenticated). A dead
  incarnation's sockets are removed at its exit. stderr is classified live
  (`classifyTunnelStderrLine`: a forbidden forward does not end ssh) and at
  each exit (`classifyTunnelStderr`); a kind no respawn can fix (`auth`,
  `host-key-mismatch`, `forwarding-refused`) stops the tunnel for good —
  `refused` — until a Retry or a changed target.
- **Demo stand-in boxes: every namespace**, through this instance's own
  gateway (`namespaceUrl(runtimeNamespace(), …)`), no tunnel — so a worktree
  exercises the whole path (`host-query`'s `standInServerIds`).
- A server without an SSH key or a pinned host key is `refused`
  (`no-ssh-key` / `unverified`) without dialing.

**What it links follows the database, push-based.** A statement trigger
(`box-link.targets`, `DbTrigger`) on `deploy_deployments`, `deploy_servers`,
`deploy_servers_ext_health` (the pinned host key — every connection check
writes it, so a replaced key verified again lands here) and
`deploy_host_stand_ins` NOTIFYs `box_link_targets`; the manager re-reads its
targets (coalesced) and reopens only a server whose target signature (address,
user, key, pin, ports) moved. A lost LISTEN re-reads once reopened.

## The stream client (`machine/internal/stream-client.ts`)

One per deployment, enabled while its tunnel is ready (a stand-in's always):
`GET /api/host-only/box-link/stream` (over the socket with `fetch(…, { unix
})`), frames read with `readNdjson` + `readBoxFrame`. A 45 s watchdog (three
missed beats, on awake time) aborts it. A failure reconnects with a bounded
backoff (2 s → 2 min, reset by a second beat — a bound around a network peer; never
by a hello or a first beat alone, or a box whose sample throws would reconnect every few s);
a 404 leaves it idle until kicked. A malformed frame or line is reported
(`box-link:stream-frame`) and ends the attempt, and so is a producer error the
box streams (`box-link:box-stream-failed` — the box's own code threw, and the
box files no report main sees).

Metered per unit of work, never as one op: the request until the box answers
(`box-link: stream connect`), each frame's handling (`box-link: stream frame`)
and the attempt's end (`box-link: stream end`) are `bg` entries of their own;
the stream's life runs in the root context, unmetered. As one entry, a stream
open for its whole link's life read as "own time" when it ended (a 27-min
stream filed as a 1,651 s slow op, report-1795399008-z56qqe).

Request-level outcomes map onto the reducer, on evidence: 404 → `outdated
(route-missing)`; the box ANSWERING with a failure (a non-OK status, the
stream it closed, a bad frame) → a `down` failure; the tunnel's exit → an
`unreachable` failure (`sshKind` from its stderr). A failure with NO answer
(the request or the connection broke, the watchdog) cannot tell the tunnel
dying from equin not listening — when a tunnel dies, the stream's failure
lands before the tunnel's exit. Through a tunnel it is an `unanswered`
event, concluding nothing; it becomes `down` only once ssh shows the
session answered after the attempt began (a forward's target refused —
`infra/ssh`'s `isForwardTargetRefusal`), whichever arrives first
(`machine/internal/tunnel-evidence.ts`), and the tunnel's exit names it
`unreachable` otherwise. A stand-in has no tunnel to doubt: no answer is
`down`.

## The state machine (`shared/reducer.ts`, pure)

`reduceLink(prev, event, env)` — events `hello`, `beat`, `heard`, `failure {
failure: down | unreachable, sshKind, error }`, `unanswered { error }`, `refused`, `route-missing`,
`grace-check`, `wake`, `restart`; `env` the facts read at the instant
(`sleptMs` since the box was last heard — `machine-sleep`'s `sleptDuring` —
and whether a deploy run of the deployment is active). Grace is 2 min:

- live → a failure: `reconnecting` (cause `restarting` while a deploy runs,
  `slept` after a sleep, else `network`), settling on its class at
  `graceUntil` (`grace-check`, an awake-time timer) unless a deploy still runs
  (extended).
- connecting / down / unreachable → a failure: its class at once, unless a
  deploy runs (`restarting`) or — for a first connect — the computer just
  slept.
- `unanswered` never settles a link: connecting / down / unreachable stay
  as they are (the error recorded); from live it opens the grace with `then`
  what the link already was, else `down` — a placeholder the tunnel's exit
  overwrites at once, and backed by the time the grace ends (a tunnel still
  up past ssh's ~45 s keep-alive bound has answered).
- `wake` gives a down / unreachable / reconnecting link a fresh grace
  (`slept`); the manager also respawns every tunnel and reconnects every
  stream.
- `refused` is sticky (a transport failure does not hide it); `outdated`
  lasts until a successful deploy run of the deployment (then `restart`) or
  a Retry.
- A successful deploy run of a `down` deployment (a Restart site, a deploy)
  reconnects its stream at once instead of waiting out the backoff.

Table-driven tests: `shared/reducer.test.ts`.

## The public-path probe (`machine/internal/public-probe.ts`)

The link proves the box answers SSH, not that visitors reach it: a 522 (Cloudflare
cannot reach the origin) while SSH works left the row green (report-1795457134-or3rra).
`deploy.box-link.public-probe`, a `defineJob` every minute (main only), GETs
`https://<first hostname>/api/health` for each deployment on a REAL box this
instance links (`store`'s `realBoxDeploymentIds` — never a stand-in), 30 s
awake bound, `user-agent: equin-public-path-probe/1`. **Polling is the documented
exception**: a site that does not answer sends no change signal. It is not a
visitor: the site's analytics count only the tracker's JS beacons, and visitor
reports come from browser JS — a server GET runs neither. Cost: one ~114 B
answer, ~0.1 s, per site per minute; a row write only when the record changes.

Pure judgement in `shared/public-probe.ts` (table-tested):

- `classifyProbe` — 200 + a health body → ok; 520–527 → `edge`; 502/503/504
  with `via: … Caddy` → `proxy`; another answer → `status`; none → `no-answer`.
- `reducePublicPath(prev, outcome, { linkLive, deployRunning })` → `ok { since }`
  or `failing { since, lastAt, misses, failure }`. A miss COUNTS only when it
  says something about the site: never while a deploy run is active at either
  end of the probe; an HTTP answer always; no answer only while the link is
  live (otherwise it may be this computer's own network, or a probe right
  after a wake). Misses are CONSECUTIVE probes: a gap past
  `PUBLIC_PATH_GAP_MS` (2.5 intervals — main stopped, the computer slept)
  starts a new outage.
- Down = `PUBLIC_PATH_DOWN_MISSES` (3) counted misses (~3 min — the link's own
  critical bound, 2 min grace + its 45 s watchdog). The probe that crosses it
  files ONE `site-public-path` report (`server-site-probe`, fingerprint per
  deployment: its count is the number of outages), naming where it broke and
  whether the box answered SSH.

Records live in memory (`store`), persisted to `deploy_deployments_ext_public_path`
on a change only (an ok record is written once; a failing one each probe, its
`lastAt`) and read back at boot (a restart mid-outage keeps its count); a
change notifies `deploy.site-health`. Per probe: report, then write, then
remember — a report or write that throws leaves the record as it was, so the
next probe crosses the threshold again and retries. Each site runs on its own
(`allSettled`); a site's failure is rethrown after the others are pushed. **Known limit:** it runs on this
computer, so it watches only while the computer is awake and main runs.

## Storage

- In memory (`machine/internal/store.ts`), served as `deploy.box-links`
  (`source: "external"`, notified on every frame that changes a link).
- `deploy_deployments_ext_box_link` (an entity extension of
  `deploy_deployments`, cascading with it): `state, since, lastHeardAt,
  lastBeat, lastError, hello`, written on a STATE change only (never per
  beat; per deployment in order, the current record), read once at boot — a
  restarted link starts `connecting` with what was last heard.

## `deploy.site-health` (`core`, served by `machine/`)

ONE value — `Record<deploymentId, SiteHealth>` — so the health report's row
set reads every deployed site with one `useLive`:

```ts
SiteHealth = {
  deploymentId, compositionId,
  hostname: string | null,                 // first public hostname
  link: { kind: "linked"; link: BoxLink }  // this instance holds it
      | { kind: "main-only" },             // a real box seen from a worktree
  run: { id, verb, phase, status, startedAt, finishedAt, message } | null,
                                           // deployments' live view (deploy.runs)
  release: RunningCommit,                  // remote-deploy: sha, subject, behindMain
  publicPath: unwatched | pending | ok { since }
            | failing { since, misses, failure },  // the public-path probe
}
```

Recomputed on a link STATE change (the manager's own notify — never a
beat), a deploy run moving (`deployRunsServed`), a deployment or run row
written (`reads`), `main` advancing (`refHeadServed`), and the public-path
probe changing a record. Per-deployment
reads (visitors, meters) stay in the row's own components.

## API

- `onBoxSignal(source, fn(deploymentId, payload))` (server) — a linked box's
  signals of one source (`BoxSignal` on the box); parse `payload` with the
  source's own schema. Doorbells: one may be lost.
- `onBoxHello(fn(deploymentId, hello))` (server) — every (re)connect: the
  catch-up cue. A throwing handler is reported and the others still run.
- `POST /api/box-link/:deploymentId/retry` (`boxLinkRetryEndpoint`,
  `needsMachine`) — a refused / blocked server is reopened from its current
  target; otherwise the tunnel respawns now and the stream reconnects. A
  `refused` / `outdated` link starts over as `connecting`; a live one is left
  alone. 404 for a deployment this instance does not link.

Tests: `./equin test plugins/apps/plugins/deploy/plugins/box-link/plugins/link`.

<!-- AUTOGENERATED:BEGIN — do not edit; regenerated by `./equin build` -->

## Plugin reference

- Description: The box link's portable half: onBoxSignal(source, fn) — a linked box's signals, the payload the source's own vocabulary — and onBoxHello(fn) — every (re)connect, the catch-up cue; the deploy_deployments_ext_box_link side-table (a link's record at its last state change, read back at boot: readKeptBoxLinks / writeBoxLinkState); and onLinkTargetsChanged(fn), a NOTIFY rung by a statement trigger on the deployments, servers, server-health (pinned host key) and stand-in tables; the deploy_deployments_ext_public_path side-table (the public-path probe's record, readKeptPublicPaths / writePublicPath) and the site-public-path report kind (one row per deployment, filed once per outage). The links themselves live in the machine half.
- Server:
  - Contributes:
    - `db-trigger` "box-link.targets"
    - `report-kind` "site-public-path"
    - `resource.declare` "deploy.box-links"
    - `resource.declare` "deploy.site-health"
  - Uses:
    - `apps/deploy/deployments._deployDeployments`
    - `apps/deploy/health.serverHealth`
    - `apps/deploy/host-query.deployHostStandIns`
    - `apps/deploy/servers._deployServers`
    - `database.DatabaseDriver`
    - `database.db`
    - `database.ListenSession`
    - `database/db-triggers.DbTrigger`
    - `database/db-triggers.defineDbTriggers`
    - `infra/entity-extensions.defineExtension`
    - `reports.ReportKind`
  - DB schema: `plugins/apps/plugins/deploy/plugins/box-link/plugins/link/server/internal/tables.ts`
  - Entity extension of:
    - `apps/deploy/deployments` (table `deploy_deployments_ext_box_link`)
    - `apps/deploy/deployments` (table `deploy_deployments_ext_public_path`)
  - Exports (types):
    - `BoxHelloHandler`
    - `BoxSignalHandler`
    - `KeptBoxLink`
  - Exports (values):
    - `onBoxHello`
    - `onBoxSignal`
    - `onLinkTargetsChanged`
    - `readKeptBoxLinks`
    - `readKeptPublicPaths`
    - `writeBoxLinkState`
    - `writePublicPath`
  - Resources:
    - `deploy.box-links` (push, notified, whole: one entry per linked deployment — a handful)
    - `deploy.site-health` (push, notified, whole: one entry per deployment row — a handful)
- Machine:
  - Uses:
    - `infra/endpoints.implementMachine`
    - `network/live.serveValue`
  - Register:
    - `defineDaemon('deploy.box-link.tunnel')`
    - `defineFileWatcher('deploy.box-link.tunnel-sockets')`
    - `defineJob('deploy.box-link.public-probe')`
  - Routes: `POST /api/box-link/:deploymentId/retry`
- Core:
  - Uses:
    - `apps/deploy/box-link.BoxLinkSchema`
    - `apps/deploy/deployments.DeployRunSchema`
    - `apps/deploy/remote-deploy.RunningCommitSchema`
    - `infra/endpoints.defineEndpoint`
    - `network/live.liveValue`
    - `packages/list-bound.wholeRecord`
  - Exports (types):
    - `ProbedPublicPath`
    - `PublicPath`
    - `PublicPathFailure`
    - `SiteHealth`
    - `SiteLink`
    - `SiteRun`
  - Exports (values):
    - `boxLinkRetryEndpoint`
    - `ProbedPublicPathSchema`
    - `PUBLIC_PATH_DOWN_MISSES`
    - `PUBLIC_PATH_GAP_MS`
    - `PUBLIC_PATH_PROBE_PATH`
    - `PublicPathFailureSchema`
    - `PublicPathSchema`
    - `siteHealth`
    - `SiteHealthSchema`
    - `SiteLinkSchema`
    - `SiteRunSchema`
- Cross-plugin:
  - Imported by:
    - `apps/deploy/box-link/site-row`
    - `apps/deploy/site-mirror/pull`

<!-- AUTOGENERATED:END -->
