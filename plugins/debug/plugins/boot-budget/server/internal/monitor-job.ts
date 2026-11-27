import {
  asPerfMs,
  perfToEpoch,
} from "@plugins/primitives/plugins/perfs/plugins/page-clock/core";
import { runInBackgroundLane } from "@plugins/infra/plugins/runtime-profiler/core";
import { z } from "zod";
import { getProfilingData } from "@plugins/framework/plugins/server-core/core";
import { defineJob } from "@plugins/infra/plugins/jobs/server";
import { getConfig } from "@plugins/config_v2/server";
import { recordReport } from "@plugins/reports/plugins/engine/server";
import { fileFinding } from "@plugins/debug/plugins/slow-ops/server";
import { bootBudgetConfig } from "../../core";
import { budgetForSpan, stepsUnder } from "./budget";

// Per-process set of boot span names ALREADY reported this process. THE dedup
// mechanism: boot happens once per process, so the profile is static after boot
// and the monitor re-reads the SAME over-budget spans every tick. Recording each
// filed span here makes a given (worktree, span-name, boot-epoch) file at most
// once — the process lifetime IS the boot epoch, so this Set is inherently
// per-boot-epoch. Across a restart the module reloads with a fresh Set, so a
// chronically-slow hook re-files, collapsing onto its stable fingerprint row
// (`count` = number of boots it was slow). This is the pull-signal analog of
// op-rate's module-level baseline maps (which gate its re-fire on unchanged
// data); boot-budget has no event stream to drain, it
// pulls a static profile, so the guard is "already reported" rather than a delta.
const reported = new Set<string>();

// Cheap per-worktree scheduled boot-budget monitor. Runs every minute in EACH
// worktree's own backend (perWorktree) because getProfilingData() is per-process
// in-memory boot state — every backend has its OWN boot profile to check.
// `dedup: "singleton"` + `maxAttempts: 3` mirror the other debug monitors.
// Silent when every boot span is within budget. Reads the post-boot profile ONCE
// per tick (pull-only, no recorder hook) and files a deduped report per boot
// hook span whose wall-time exceeds its per-phase budget (warm-ups are judged by
// slow-ops on their `bg` span — see budget.ts).
export const bootBudgetMonitorJob = defineJob({
  name: "debug.boot-budget-monitor",
  description:
    "Files a report for each startup step that took longer than its time budget.",
  hold: "instant",
  input: z.object({}),
  event: z.never(),
  dedup: "singleton",
  schedule: { cron: "* * * * *", perWorktree: true },
  maxAttempts: 3,
  run: async () => {
    const cfg = getConfig(bootBudgetConfig);
    if (!cfg.enabled) return;

    const { spans, memoryCheckpoints, bootStartOffsetMs } = getProfilingData();
    // Span offsets (on the performance clock, from `bootStartOffsetMs`) → wall
    // clock (epoch ms), through the clocks' offset now.
    const wallOf = (offsetMs: number): number =>
      perfToEpoch(asPerfMs(bootStartOffsetMs + offsetMs));
    // The authoritative phase-boundary RSS snapshots (per-span deltas overlap in
    // the parallel onReady phases and are only directional). Carried into the
    // report so the reader can tell heavy CPU work (RSS spikes) from IO wait
    // (flat RSS) — trimmed to the compact fields the renderer shows.
    const checkpoints = memoryCheckpoints.map((c) => ({
      label: c.label,
      atMs: c.atMs,
      physFootprintMb: c.physFootprintMb,
      heapUsedMb: c.heapUsedMb,
    }));

    for (const span of spans) {
      const budgetMs = budgetForSpan(span, cfg);
      if (budgetMs === null) continue; // not a monitored boot span
      if (span.durationMs <= budgetMs) continue; // within budget
      if (reported.has(span.id)) continue; // already filed this boot
      reported.add(span.id);
      const steps = stepsUnder(span, spans);
      const message = `${span.id} — ${span.durationMs}ms boot (${span.phase}, budget ${budgetMs}ms)`;
      // A hook that ran while every tab replayed after this restart (onReady,
      // onAllReady) is evidence of the tabs' "not live again" reports, not a
      // report of its own; one before ready (onReadyBlocking: the predecessor
      // still served every tab) or on a boot nobody replayed files as before.
      // D26 step 3 — slow-ops' findings.ts. Not awaited: the judgement waits
      // on the restart replay while it is unsettled (up to ~33 s), past this
      // instant job's hold; a failure still rejects loudly.
      void runInBackgroundLane(() =>
        fileFinding(
          {
            source: "boot-budget",
            what: message,
            ms: span.durationMs,
            startMs: wallOf(span.startMs),
            endMs: wallOf(span.startMs + span.durationMs),
        },
          () =>
            recordReport({
              kind: "boot-budget",
              source: "server-boot-budget-monitor",
              data: {
                spanName: span.id,
                phase: span.phase,
                ...(span.plugin ? { plugin: span.plugin } : {}),
                durationMs: span.durationMs,
                budgetMs,
                memoryCheckpoints: checkpoints,
                ...(steps.length > 0 && { steps }),
              },
              message,
            }),
        ),
      );
    }
  },
});
