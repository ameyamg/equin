import type { MachinePluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { Trigger } from "@plugins/infra/plugins/events/server";
import {
  hostIdleBegan,
  hostIdleEnded,
} from "@plugins/infra/plugins/host/plugins/idle/server";
import {
  testDigestsSettled,
  testRunsIngested,
} from "@plugins/debug/plugins/tests/server";
import {
  batchOnMainAdvance,
  idleBatchJob,
  idleBeganJob,
  idleEndedJob,
  idleNextJob,
} from "./internal/idle-runner";

export default {
  description:
    "The checkout's test runner: runs the test files whose verdict on the current code is owed (to confirm, seen failing elsewhere, stale, never run) — on main whenever an opportunistic op may run, so main's verdicts follow its head; elsewhere, and for the 7-day re-verify sweep, only while the host is idle. Each tests.digestsSettled, tests.runsIngested and batch end (after its record is ingested and judged) starts the next tests.idle-batch — `./equin test` on files chosen by selectIdleBatch, opportunistic, origin idle; an advance of main cancels the running batch (main), host.idleEnded the running sweep.",
  register: [
    idleBatchJob,
    idleNextJob,
    idleBeganJob,
    idleEndedJob,
    batchOnMainAdvance,
  ],
  contributions: [
    Trigger({ on: hostIdleBegan, do: idleBeganJob, with: {}, oneShot: false }),
    Trigger({ on: hostIdleEnded, do: idleEndedJob, with: {}, oneShot: false }),
    Trigger({
      on: testDigestsSettled,
      do: idleNextJob,
      with: {},
      oneShot: false,
    }),
    Trigger({
      on: testRunsIngested,
      do: idleNextJob,
      with: {},
      oneShot: false,
    }),
  ],
} satisfies MachinePluginDefinition;
