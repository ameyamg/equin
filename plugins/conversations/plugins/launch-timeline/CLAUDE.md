# launch-timeline

**One record per agent launch**, from the request to the first streamed token
and the first complete message — `conversations_ext_launch`, one row per
conversation its spawn job launches. Before it, measuring a launch meant joining
four stores (the conversations rows, `supervised_job_runs`, the
`worktree-prepare.jsonl` log, the agent's `events.jsonl`), and the first token
was recorded nowhere
([`research/2026-11-17-global-launch-and-build-latency-benchmark.md`](../../../../research/2026-11-17-global-launch-and-build-latency-benchmark.md), fix 7).

## The record

`requestedAt` (the conversation's creation) plus `marks` — the request's and
each phase's instant, in `LAUNCH_INSTANT_IDS` (core, a closed list) — plus
`checkoutSteps` (the checkout child's `SetupStep` spans with the instant each
ended) and `checkoutSource` (`spare` / `fresh` / `existing`).

**Every instant is a `ClockStamp`** (`packages/sleep-clock/stamp`):
`{ wallMs, sleep: { boot, asleepMs } | null }` — the wall instant and the
machine's sleep clock read together, by the process that saw it. Every writer
is on this machine, so any two stamps compare, and **a stretch is judged on
awake time**: `awakeBetween(from, to).awakeMs`, the wall span less the sleep
inside it. A Mac sleeps through launches (on battery it naps in cycles); on
the wall clock that read as launch latency — on 2026-11-21 a "request → first
token" of 7320 s was 110 s awake, and a 14.8 s checkout step sat inside a
2134 s gap. `sleep` is null where it cannot be told (records from before
2026-11-23, migrated as wall-only; a platform without the clock): that stretch
reads as wall time and is counted as such. A checkout step's `ms` was always
awake time (the child times it on `performance.now()`); its `end` is a stamp
like the marks.

- `requested`: the conversation row has only a wall instant (`created_at`),
  so the spawn job stamps it when it opens the record: its own stamp less the
  sleep its process saw since (`infra/host/machine-sleep`'s
  `stampOfWallInstant`).
- **Bare wall instants still read.** The data migration turned every old
  mark and step into a stamp with `sleep: null`, and the schema reads a bare
  number (or a step's `endAt`) the same way, for a writer still on the old code
  across that deploy.
- **The request's sleep is a lower bound.** `sleptDuring` knows the sleeps the
  spawn's process lived through and the one before it started: a backend
  restarted between two naps after the request, or a reboot, leaves sleep
  untaken out — the queue stretch reads high, never low.
- The writers (`server/`) take stamps; their callers read the clocks. The
  barrel stays portable: it also serves `conversations.launches`, which the
  in-browser demo's host answers without the computer's `bun:ffi`.
- `prepare-child-started`: `processStartStamp()` — the process start, exact
  however long after it the child first reads its clocks.
- The agent's phases: `bin/agent.ts` stamps each `agent` lifecycle line
  (`t` + `sleep`, runtime-sdk's protocol), read back as one stamp.

| phase | written by | when |
|---|---|---|
| (request) | the spawn job, `openLaunch` | `requestedAt` = `conversations.created_at` |
| `spawn-started` | the spawn job, `openLaunch` | its body's first run |
| `prepare-child-started` | the `worktree.prepare` child, `markCheckoutBooted` | its process start (`performance.timeOrigin`) — before its `worktree-prepare` slot wait and boot |
| `prepare-booted` | same | its run body starts (slot held, graph booted) |
| steps | the child, `markCheckoutEnded` | each `setupWorktree` step (gate-wait, claim, switch, add, tree-write, lock, dep-store, install, index-refresh) |
| `prepare-ended` | same | `setupWorktree` returned |
| `agent-started` | runtime-sdk's consumer, `markAgentLaunchPhase` | the agent's `started` line — since fix 6, as soon as the checkout's files exist, so usually BEFORE `prepare-ended` (the install and index refresh overlap the agent's start; the launch prompt is typed once `prepare-ended`) |
| `cli-ready` | same | its `ready` line (Claude Code's initialize) |
| `first-token` | same | its `first_token` line: the first streamed content frame (not `message_start`), once per process |
| `first-message` | same | its `first_message` line: the first complete top-level assistant message (not a failed request's), once per process |

- **First-wins.** Every write is `new || marks` (jsonb: the right side wins),
  so a retried spawn, a re-requested checkout or a replayed events file never
  moves an instant. A failed checkout child leaves its start and boot; the
  retry's end lands on the same record, so `prepare-booted → prepare-ended`
  covers both.
- **The launch's own agent only.** `agent-started` claims the record for its
  pid (`agentPid`, server-only) when none has; later phases mark it only from
  that pid — a resume days later never fills in a phase the launch's agent
  did not report (an agent started before `first_token` existed).
- **A spawn that gives up abandons its record** (`abandonLaunch`, from the
  spawn's `onDead` and its Claude-Code-missing exit): `abandonedAt` is set and
  no later process claims it.
- **The checkout child marks its launch by conversation id** — the spawn hands
  it down (`WorkspacePrepareCtx.conversationId` → the `worktree.prepare` input;
  the run is still locked and found by attempt). A re-requested run leaves an
  ended checkout's steps as they were.
- **Not recorded**: launches that do not go through the spawn job — a resume,
  a fork, a rewind, a hibernation wake (`inline-launch.ts`). A scratch
  workspace's launch has no checkout phases; it counts only in the stretches
  it has.

## Reading it

- **People**: Debug → Profiling → the agent launches section (`web/`): the
  newest 200 records (`conversations.launches`, a window by `requestedAt`),
  each stretch's awake p50 / p90 / n (`LAUNCH_SEGMENTS`), how many of them
  slept through it (taken out) or could not tell (wall), split by spare /
  fresh checkout, and each checkout step's. Stats are per stretch over the launches
  that reached both its ends (`segmentStats`), so a change that reorders phases
  (starting the agent while the checkout installs) shows as a negative
  stretch while the `Request → …` totals stay comparable.
- **Agents** (`query_db`, main's DB `equin`):

  ```sql
  -- Awake ms from <from> to <to>: the wall span less the sleep between the
  -- two stamps (none taken out across a reboot or an unstamped side).
  WITH s AS (
    SELECT marks->'requested' AS a, marks->'first-token' AS b
    FROM conversations_ext_launch
    WHERE marks ? 'first-token' AND requested_at > now() - interval '7 days'
  )
  SELECT percentile_disc(ARRAY[0.5, 0.9]) WITHIN GROUP (ORDER BY
           (b->>'wallMs')::numeric - (a->>'wallMs')::numeric
           - CASE WHEN a->'sleep'->>'boot' = b->'sleep'->>'boot'
                  THEN (b->'sleep'->>'asleepMs')::numeric
                       - (a->'sleep'->>'asleepMs')::numeric
                  ELSE 0 END) AS request_to_first_token_awake
  FROM s;
  ```

  Never subtract `->>'wallMs'` alone: that is the wall span, a night's
  sleep included. Steps are `jsonb_array_elements(checkout_steps)` (`ms` is
  already awake).

<!-- AUTOGENERATED:BEGIN — do not edit; regenerated by `./equin build` -->

## Plugin reference

- Description: Agent launches in Debug → Profiling: per-stretch p50 / p90 of the newest launch records (request → spawn → checkout child start, boot, checkout → agent started → CLI ready → first token → first message, and the totals), split by spare / fresh checkout, and each checkout step's. One record per agent launch (conversations_ext_launch): from the request to the first streamed token and the first complete message — the spawn job opens it (openLaunch), the worktree.prepare child marks its start, boot, every checkout step and its end (markCheckoutBooted / markCheckoutEnded), and the sdk runtime marks what the agent's events report (markAgentLaunchPhase: started, CLI ready, first token, first message). First-wins marks; served as the conversations.launches window.
- Web:
  - Contributes: `Profiling.Section` → `LaunchesSection`
  - Uses:
    - `debug/profiling.formatDuration`
    - `debug/profiling.Profiling`
    - `network/live.useLive`
    - `network/live/live-state.ResourceErrorInline`
    - `primitives/css/spacing.Inset`
    - `primitives/css/spacing.Stack`
    - `primitives/css/text.SectionLabel`
    - `primitives/data-table.ColumnDef`
    - `primitives/data-table.DataTable`
    - `primitives/loading.Loading`
- Server:
  - Contributes:
    - `resource.declare` "conversations.launches"
    - `resource.declare` "conversations.launches:groups"
    - `resource.declare` "conversations.launches:rows"
  - Uses:
    - `database.db`
    - `infra/entity-extensions.defineExtension`
    - `network/live.serveCollection`
    - `tasks/tasks-core._conversations`
  - DB schema: `plugins/conversations/plugins/launch-timeline/server/internal/tables.ts`
  - Entity extension of: `tasks/tasks-core` (table `conversations_ext_launch`)
  - Exports (values):
    - `abandonLaunch`
    - `markAgentLaunchPhase`
    - `markCheckoutBooted`
    - `markCheckoutEnded`
    - `openLaunch`
  - Resources:
    - `conversations.launches` (keyed, window)
    - `conversations.launches:groups` (push)
    - `conversations.launches:rows` (keyed, point)
- Core:
  - Uses:
    - `fields.nullable`
    - `fields/date/config.dateField`
    - `fields/int/config.intField`
    - `fields/json/config.jsonField`
    - `fields/text/config.enumTextField`
    - `fields/text/config.textField`
    - `infra/entity-extensions.defineExtensionShape`
    - `network/live.liveCollection`
    - `packages/list-bound.cappedList`
    - `packages/sleep-clock/stamp.awakeBetween`
    - `packages/sleep-clock/stamp.ClockStamp`
    - `packages/sleep-clock/stamp/schema.ClockStampSchema`
  - Exports (types):
    - `AgentLaunchPhase`
    - `CheckoutSourceKind`
    - `CheckoutStep`
    - `LaunchInstant`
    - `LaunchMarks`
    - `LaunchPhase`
    - `LaunchRecord`
    - `LaunchSample`
    - `LaunchSegment`
    - `Percentiles`
    - `SegmentStats`
  - Exports (values):
    - `AGENT_LAUNCH_PHASES`
    - `CHECKOUT_SOURCES`
    - `CheckoutStepSchema`
    - `checkoutStepStats`
    - `conversationLaunches`
    - `instantOf`
    - `LAUNCH_INSTANT_IDS`
    - `LAUNCH_PHASE_IDS`
    - `LAUNCH_PHASES`
    - `LAUNCH_SEGMENTS`
    - `LaunchMarksSchema`
    - `launchShape`
    - `MAX_CHECKOUT_STEPS`
    - `percentiles`
    - `segmentStats`
- Cross-plugin:
  - Imported by:
    - `conversations`
    - `conversations/runtime-sdk`
    - `conversations/workspace/worktree`

<!-- AUTOGENERATED:END -->
