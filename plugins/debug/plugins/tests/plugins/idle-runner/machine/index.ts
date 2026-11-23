import type { MachinePluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { Trigger } from "@plugins/infra/plugins/events/server";
import {
  testDigestsSettled,
  testRunsIngested,
} from "@plugins/debug/plugins/tests/server";
import {
  followRunnerSwitch,
  idleBatchJob,
  idleNextJob,
  runnerAtMainBoot,
  runnerOnMainAdvance,
} from "./internal/idle-runner";

export default {
  description:
    "Main's test runner (off unless turned on in Settings → Config, main only): after each push it runs the test files whose verdict on main's current code is owed — the files the push changed (stale, never run), a failure another checkout saw on main's code, and one confirming run of a file that failed once — never a re-run of unchanged code. Main's boot and every advance bring its test digests to the new tree; each tests.digestsSettled, tests.runsIngested and batch end (after its record is ingested and judged) starts the next tests.idle-batch — `./equin test` on files chosen by selectDueBatch, opportunistic; an advance cancels the running batch.",
  register: [idleBatchJob, idleNextJob, runnerOnMainAdvance, runnerAtMainBoot],
  contributions: [
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
  onAllReady: followRunnerSwitch,
} satisfies MachinePluginDefinition;
