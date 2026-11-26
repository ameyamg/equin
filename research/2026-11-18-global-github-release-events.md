# GitHub releases and CI runs, pushed into equin

## Context

On 2026-11-18 the releases health row said "Latest 2026.11.18 · just now", but
GitHub's newest Release was still 2026.11.17.2. The row reads only local git
tags. The `v2026.11.18` run of `installer-release.yml` failed in
`Linux (linux-arm64)`, so no Release was published, and nothing in equin said
so.

What failed:

- **The smoke test.** Commit `a2559eaca1` prints a step that has sub-steps as
  a bare heading (`  Build equin`). The CI smoke test still searched for
  `✓ Build equin`. The fix is already in this worktree: the test now searches
  for `✓ Start equin`, the last step.
- **The Release waits on the installer.** The Release stays a draft until all
  three installer binaries are built and tested (~5 min). One broken installer
  job means no Release at all.
- **GitHub never tells equin anything.** equin has no inbound path from
  GitHub, so a failed publish is invisible. The same is true for
  `equinai/pg-client-embedded` and `equinai/pgbouncer-embedded`. Their
  "Build and Publish" workflows publish npm packages, either daily on a cron
  or on a `v*` tag / manual run. equin depends on those packages.

What we want:

1. The Release is published right after the tag. The installer binaries are
   attached when they are ready. An installer failure no longer blocks the
   release.
2. The releases row shows what GitHub shows: publishing, published, or
   failed.
3. A failed run of any watched workflow, in any of the three repos, files an
   equin **report**.
4. All of this is pushed, with no polling. The user picked this transport:
   **`gh webhook forward`**.

## Design

### 1. Transport: a new `integrations/github-events` plugin

**The forwarder daemon** (`machine/`):

- It is a `defineDaemon` (`plugins/infra/plugins/spawn/plugins/daemon`) with
  `where: "main"` and `restart: backoff`. It runs only when this checkout is
  the publisher (`resolveUpstreamRemote` → `is-publisher`, as in
  `upstream/machine/internal/publisher-status.ts`).
- It runs: `gh webhook forward --org=equinai --events=workflow_run,workflow_job,release --url=<main's delivery URL> --secret=<per-start random secret>`.
- GitHub creates a temporary org webhook and streams its deliveries over a
  WebSocket. Nothing has to be reachable from the internet.
- `gh` and its auth come from the repo toolchain (`gh` is in `mise.lock`).
  The `cli/gh-webhook` extension is declared as an on-demand dependency
  (`infra/deps`), so it is installed and pinned, never assumed to be there.

**The delivery endpoint** (`server/`):

- `POST /api/github-events/deliveries` checks `X-Hub-Signature-256` against
  the secret of the current daemon start, and rejects a bad signature loudly.
- It parses each event with zod. Only the fields we use are kept:
  - `workflow_run`: id, attempt, repo, workflow path/name, head branch/sha,
    event, status, conclusion, html_url.
  - `workflow_job`: run id, name, conclusion, html_url, failed step names.
  - `release`: repo, tag, draft, asset names, html_url.
- It upserts the event into two tables, `github_runs` (key: repo, run id,
  attempt, with its jobs) and `github_releases` (key: repo, tag).
- Both tables are served as `liveCollection` + `serveCollection` with a
  bounded `limit`.

**Catching up after a disconnect:**

- A forwarder only receives events while it is connected. On every daemon
  (re)start, the plugin does one `gh api` listing per watched workflow
  (`/actions/workflows/<wf>/runs?per_page=10`). For a watch that also tracks
  releases, it lists `/releases?per_page=5` too.
- The results go through the same upsert. This is a catch-up on connect, not
  polling: nothing runs again until the next reconnect.

**Health row** "GitHub events" (shown only on the publisher):

- States: connected / reconnecting / not set up.
- When not set up, it says why: the extension is missing, or `gh` lacks the
  `admin:org_hook` scope. In that case it shows the exact command,
  `gh auth refresh -s admin:org_hook`.

**What is watched is an open set declared by the plugin that owns each
repo.** A `GitHubEvents.Watch({ repo, workflow, releases?: true })` server
contribution lists it. The ingest stores only events that match a watch. Each
owner contributes its own:

| Owner plugin | Watch |
|---|---|
| `installer/release-assets` | `equinai/equin` · `installer-release.yml` · releases |
| `database/client-tools` | `equinai/pg-client-embedded` · `build-and-publish.yml` |
| `database/pgbouncer` | `equinai/pgbouncer-embedded` · `build-and-publish.yml` |

### 2. Report kind `github-run-failed`

The kind lives in the same plugin, laid out like `reports/plugins/host-check`
(core kind/schema/fingerprint/message, server `ReportKind`, web
`Reports.KindView`).

- **When it is filed:** a `workflow_run` completes with
  `conclusion: failure` (or `timed_out`) on a watched workflow and an event
  other than `pull_request`. It is filed in-process with `recordReport`, once
  per run attempt; the `github_runs.reported_at` column records that.
- **Payload:** repo, workflow, event, head (the tag when the run is for a tag,
  else the branch), sha, run url, and the failed jobs with their failed step
  names. The failed jobs come from the `workflow_job` events stored for that
  run.
- **Fingerprint:** `repo + workflow + head`. A re-run of the same tag, or the
  same daily cron failing again on main, collapses onto one report.
- **`renderTask`:** names the failing job and step, gives the run link and
  `gh run view <id> -R <repo> --log-failed`. For `installer-release` it also
  gives the re-publish command (`gh workflow run installer-release.yml -f ref=<tag> -f replace=true`).
- **No code-staleness guard** (`code` omitted), because this is external
  state. As with any report, a later green run does not close it; the fix
  ledger stays as it is.

### 3. Releases row shows GitHub's state

`upstream/web/internal/releases-view.ts` gets a pure
`githubPublication(latestTag, runs, release)` with tests. The machine
`publisher-status` gains a `github` field derived from the two collections.
It is recomputed on their changes and never fetched.

| GitHub state | Row |
|---|---|
| no run seen for the tag yet | "Waiting for GitHub" (pulsing) |
| run in progress, no public Release | "Publishing on GitHub…" (pulsing) |
| Release public, installers missing, run in progress | "On GitHub · installer building" |
| Release public with every `INSTALLER_BINARIES` asset | ok |
| run failed, no public Release | **attention** "GitHub release failed", with Open run |
| Release public, installer jobs failed | **attention** "On GitHub without the installer window", with Open run |
| forwarder not connected | unknown "GitHub not connected" (never claims "published") |

The installer asset names come from `installer/release-assets/core`
(`INSTALLER_BINARIES`). They are never spelled out again in the row.

### 4. Workflow: publish first, installer attached after

`.github/workflows/installer-release.yml` becomes:

- **`validate`**: unchanged.
- **`publish`** (needs only `validate`):
  1. Assemble `install.sh`, `release.json` and `SHA256SUMS` from the tag.
  2. Attest them.
  3. Publish the Release (draft → public, `--latest`).
  4. If the Release already exists and `replace` is off, skip publishing
     (not an error), so a manual run can attach the installer to an existing
     Release.
  5. Target: ~1 min after the tag.
- **`page`, `macos`, `linux`**: unchanged.
- **`attach`** (needs `publish`, `macos`, `linux`): uploads the binaries and
  `INSTALLER-SHA256SUMS`, with its own provenance file, using
  `gh release upload --clobber`. `INSTALLER-SHA256SUMS` goes last.

**The files published first never change.** `release.json` stops listing the
binaries, which would have needed the hashes before they existed. It says
instead that a window is published separately (`installers: 1`), and it
bumps the manifest version (`v`).

Stage 0 in `install.sh`, for a manifest that says `installers: 1`:

- It downloads `INSTALLER-SHA256SUMS`.
- If that file is absent (404), it uses the terminal view and says so: "this
  release's installer window isn't published (yet)".
- Otherwise it verifies the binary against that file.

Compatibility:

- **Old stage 0 reading a new manifest:** it finds no asset key, so it
  installs in the terminal view.
- **New stage 0 reading an old manifest:** the current asset-key path is
  kept.
- `release-assets/core` owns the new names and the manifest change, and
  `assemble.ts` splits into `--core` and `--installer` modes. The
  `release-assets` check and its CLAUDE.md contract are updated.

Why not rewrite `release.json`/`SHA256SUMS` when the binaries arrive: a
client that downloads one file before the rewrite and the other after it gets
a checksum mismatch.

## Critical files

- New: `plugins/integrations/plugins/github-events/{core,server,machine,web,deps}/…`
- Watches: `plugins/installer/plugins/release-assets/server/`,
  `plugins/database/plugins/client-tools/server/`,
  `plugins/database/plugins/pgbouncer/server/`
- Row: `plugins/upstream/plugins/release/core/internal/publisher-value.ts`,
  `plugins/upstream/machine/internal/publisher-status.ts`,
  `plugins/upstream/web/internal/releases-view.ts` (+ test),
  `plugins/upstream/web/components/releases-row.tsx`
- Workflow and installer: `.github/workflows/installer-release.yml`,
  `install.sh` (stage 0),
  `plugins/installer/plugins/release-assets/{core,scripts/assemble.ts,check,CLAUDE.md}`

Patterns to reuse:

- `defineDaemon`.
- `recordReport` and the report kind layout of `reports/plugins/host-check`.
- `serveValue` with `recomputeOn`, as in `publisher-status.ts`.
- `resolveUpstreamRemote` for the publisher gate.
- `defineEndpoint` for the delivery route.

## Spike results (step 0, 2026-11-18)

Run against `equinai/equin` with `cli/gh-webhook`. Every test hook was deleted
afterwards.

- **Per-repo forwarding works with the existing token scopes** (`repo`,
  `workflow`). Org forwarding would need `admin:org_hook`, so the plan uses
  **one forwarder per watched repo** (`--repo`). That needs no scope change,
  and it fits the per-repo watch contributions.
- **A repo holds at most one forwarder hook** (named `cli`, url
  `https://webhook-forwarder.github.com/hook`). A second start fails with
  `422 Hook already exists`.
- **Stopping cleanly:**
  - SIGTERM sent to the extension binary
    (`~/.local/share/gh/extensions/gh-webhook/gh-webhook`) deletes the hook.
  - SIGTERM sent to the `gh` wrapper orphans the extension. It keeps running
    and keeps its hook.
  - So the daemon spawns the extension binary directly. Before each start it
    deletes any stale forwarder hook a hard kill left behind.
- **The `ping` event arrives on connect.** It is the "connected" signal for
  the health row.
- **Headers on each delivery:** `x-github-event`, `x-github-delivery`,
  `x-hub-signature-256` (HMAC over `--secret`), and also
  `x-forwarded-for`/`x-forwarded-proto`. Because of the forwarded headers,
  **the gateway classifies a delivery as a `visitor`, never the owner**. The
  delivery endpoint is therefore declared
  `access: { public: "GitHub webhook deliveries, authenticated by their HMAC signature" }`.
  It verifies the signature before it reads anything.
- **`http://equin.localhost:<port>/…` resolves from the Go forwarder** (no
  transport error).

## Risks to settle first (spike, step 0)

- **`gh webhook forward` is a preview extension.** The spike confirms four
  things before the plugin is built:
  - `--org` works for `equinai`.
  - Several events can be forwarded at once.
  - A single forwarder per org is allowed.
  - The org webhook is removed when the forwarder exits.
- **The scope.** The forwarder needs the `admin:org_hook` scope on the user's
  gh token. That is a one-time `gh auth refresh`, and the health row asks for
  it.
- **The delivery URL.** It has to reach main's backend through the gateway,
  and a local request has to pass `principal` access. If it does not, the
  endpoint is declared accordingly; the HMAC signature remains the
  authentication.

## Verification

- **Unit tests:**
  - `githubPublication` over every row state.
  - The event zod parsers on real payload fixtures.
  - The fingerprint and once-per-attempt filing.
  - `releaseManifest` v2 and `assemble` in both modes.
- **Stage 0:** `install.sh --stage0-only` against a fixture Release with no
  `INSTALLER-SHA256SUMS` (terminal view) and one with it (window).
- **Workflow:** a manual run with `publish` off on this branch builds both
  phases. Then re-publish `v2026.11.18` with `replace` on: the Release is
  public within about a minute, and the installer is attached later.
- **End to end on main after push:**
  - The health row goes "Publishing on GitHub…" → "On GitHub".
  - A forced failure (a manual run of a bad ref with publish off) files one
    `github-run-failed` report, and a re-run collapses onto it.
  - A failed pg-client-embedded run (or its catch-up listing) files the same
    kind.
- `./equin check` and `./equin test plugins/integrations/plugins/github-events plugins/upstream plugins/installer`.

## Follow-up (2026-11-26): should a forwarder outlive backend restarts?

Asked after the publisher's releases row was seen grey ("Connecting to
GitHub…"). Today each of main's backend starts spawns one forwarder per watched
repo, and each stop kills them. Main's backend started 78 times in the 24 h
before 11-25 13:55, and 93 times in the 24 h before this writing.

### What a restart actually costs (measured 2026-11-26)

- **The connecting window is about 3 s.** In one observed hot restart (ready
  at 18:11:20 UTC), `equinai/equin`'s forwarder hook changed straight from the
  old id to the new one at about 18:11:23. Sampling every 1.5 s showed no hook
  flapping, even though the gateway's hot restart runs the old and new
  backends side by side for a moment. The current hooks of all three repos
  were created 3 s after the previous ready. So the grey row lasts a few
  seconds per restart. It is noticeable only because main restarts every few
  minutes on busy days.
- **Hook churn costs nothing measurable.** About 3 hook creates per restart,
  plus about 5 catch-up `gh api` reads. That is roughly 300 to 800 REST calls
  a day, against a budget of 5000 an hour. GitHub sets no limit on hook
  creation.
- **Catch-up failures are already fixed.** The `[github-events] catching up …
  failed` reports stop on 2026-11-22. From then on a catch-up cut by a machine
  sleep is retried and logged on the `github-events` channel, not reported
  (`catch-up-owed.ts`). The `connection reset by peer` and SIGTERM timeout
  lines in `logs/github-events.jsonl` are those logged retries.
- **Correction to the spike notes.** `cli/gh-webhook` v0.2.0 has no signal
  handling and never deletes its own hook (`webhook/forward.go`,
  `create_webhook.go`). GitHub's forwarder service deletes the hook when the
  WebSocket closes. A SIGTERM to the extension works because it closes the
  socket. A SIGTERM to the `gh` wrapper does not, because the orphaned
  extension keeps the socket open. Inside one process the extension retries
  an abnormal WebSocket close 3 times, 5 s apart, on the same hook, then
  exits. A normal close exits 0.

### Option A: a forwarder that outlives backends (detached and adopted)

One forwarder process per repo per machine, launched by main's backend through
`launchDetached`, and adopted by the next backend through its pid file. It
would need:

1. **A state file per repo**, mode 0600 in a `data-dirs` folder: the secret,
   the digest of its argv (repo, events, delivery URL, extension path) and the
   incarnation's pid. Both backends of a hot restart would verify with the same
   secret, so no delivery would get a 401 during the swap.
2. **A pid-writing bootstrap**: the current `/bin/sh` script runs
   `echo $$ > pid` before its `exec`.
3. **Adoption on boot**: if a forwarder is alive and its argv digest matches,
   attach to it. Otherwise SIGTERM it and launch a new one.
4. **Respawn with backoff.** The extension exits on any lasting disconnect,
   such as each machine sleep or a network change, so it must be brought back
   with backoff. The daemon primitive refuses this today: `launchDetached` /
   `attach` exist only on `restart: never`, because "nothing here can respawn
   what it is not the parent of". So either the plugin writes its own
   relaunch-and-backoff loop (a second supervision loop, which the primitive
   exists to prevent), or the primitive gains a new arm: a detached instance
   that any backend adopts and relaunches through the supervise loop. That
   second choice is a new primitive capability.
5. **"Connected" across restarts.** A re-attached forwarder sends no new ping.
   The state file would record the ping time of the current incarnation, and
   a successor would trust it only while the pid is the same.
6. **Failure explanation.** A detached process's stderr goes to a file, not
   to `onStderrLine`. The health row's "why it stopped" would read that file's
   last line.
7. **Deliveries while no backend serves.** The extension logs `error
   forwarding event` and does not answer GitHub, so the delivery is lost. A
   boot catch-up is still owed (cheaper: no hook churn, only the reads).

Gains: no grey seconds after a restart, no hook churn, and no 401 during the
hot-restart overlap.
Costs: a new capability in the daemon primitive (adopt and relaunch a detached
instance), a secret persisted on disk, a second notion of "connected", and
reading stderr from a file. The secret on disk is minor (main's DB and gh's
token sit beside it).

### Option B: keep the per-backend lifecycle, and make the connect honest but quiet

Leave the transport as it is. Only the presentation changes: while a
forwarder is `connecting` for the first time after its backend started, the
publication row shows the stored state from the previous connection, marked
"checking GitHub…", instead of going grey. It turns `unknown` only if the
connect has not finished within a short bound, or the forwarder is
`reconnecting` / `failed`. This bends the rule "never claims published on
stale news", but only for the few seconds before the catch-up rereads the
newest runs and releases. A run that ended while no backend was up is then
corrected within seconds.

Cost: one view rule in `upstream/web/internal/releases-view.ts` and a
`connecting` publication that carries the stored rows
(`upstream/machine/internal/publication.ts`). No new primitive.

### Option C: change nothing

The window is about 3 s, the churn costs nothing measurable, and the catch-up
noise is gone since 11-22.

### Recommendation

**C now, A only if a second consumer needs a process that survives backend
restarts and respawns.** With today's numbers, A's gain is a few grey seconds
per restart and some hook churn nobody pays for. Its price is a new primitive
capability plus a persisted secret. If the grey seconds still bother the user,
B removes them in a small UI change. The real driver is how often main
restarts, which is restart-skip's territory, not this plugin's.
