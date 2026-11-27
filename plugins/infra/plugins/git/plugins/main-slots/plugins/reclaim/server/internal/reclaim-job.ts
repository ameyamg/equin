import { z } from "zod";
import { CLI_NAME } from "@plugins/framework/plugins/cli/plugins/cli-name/core";
import { REPO_ROOT } from "@plugins/infra/plugins/paths/plugins/repo-root/core";
import { defineSupervisedJob } from "@plugins/infra/plugins/jobs/plugins/supervised-job/server";
import { defineLogSink } from "@plugins/primitives/plugins/log-channels/server";

const reclaimLog = defineLogSink({
  id: "main-slots-reclaim",
  description:
    "Main-slots reclaim log: one run a day — slots stamped unserved, drain reports filed, free slots removed.",
});

/**
 * Daily, main only (a schedule's default): `./equin main-slots-reclaim`
 * (this plugin's command) — the same `reclaimSlots` every main
 * build ends with, as a backstop for what no event can announce: a process
 * killed with SIGKILL never releases its lease, so the slot it held frees
 * with nobody there to reclaim it until the next build. The documented
 * exception to "no polling": the scheduled job is the change signal.
 *
 * In a supervised child (git worktree removal, an install's worth of file
 * deletion), never on a backend's event loop. `runAttempts: 1`: the next day,
 * or the next build, is the retry.
 *
 * Here, not in main-slots' own `server/`: supervised-job reads main-slots
 * core (which slot main serves, for its `acrossSwitch` start gate), so
 * main-slots itself must not import supervised-job.
 */
export const reclaimSlotsJob = defineSupervisedJob({
  name: "main-slots.reclaim",
  description:
    "Frees main's slots nothing runs from any more (keeping one ready for the next build) and reports processes that kept an old slot busy after their app moved on.",
  input: z.object({}),
  channel: reclaimLog,
  acrossSwitch: {
    finish:
      "it reclaims main's slot pool, under the pool lock: valid whichever commit's code runs it, re-attached by the next backend",
  },
  schedule: { cron: "23 4 * * *" },
  runAttempts: 1,
  argv: () => ({
    argv: [`./${CLI_NAME}`, "main-slots-reclaim"],
    cwd: REPO_ROOT,
  }),
});
