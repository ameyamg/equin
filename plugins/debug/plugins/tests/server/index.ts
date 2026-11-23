import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { TaskCategory } from "@plugins/tasks/plugins/task-category/server";
import { ConfigV2 } from "@plugins/config_v2/server";
import { TESTS_CATEGORY_ID, testRunnerConfig } from "../core";
import { resultsCapJob } from "./internal/cap-job";
import { testDigestsSettled, testRunsIngested } from "./internal/tables-events";
import {
  testCaseFailuresServed,
  testFileRunsServed,
  testFileStatusServed,
} from "./internal/resources";

export {
  _testCaseFailures,
  _testCheckoutDigests,
  _testDigestGeneration,
  _testFileResults,
  _testFileStatus,
  _testRuns,
} from "./internal/tables";
export { recomputeFileStatus } from "./internal/recompute";
export {
  _testDigestsSettledTriggers,
  _testRunsIngestedTriggers,
  testDigestsSettled,
  testRunsIngested,
} from "./internal/tables-events";
export { ingestedOpIds, ingestRunRecord } from "./internal/ingest-record";
export type { DbExec } from "./internal/db-exec";

export default {
  description:
    "Debug → Tests, portable half: the harvested test verdicts (test_runs, test_file_results, test_case_failures), the checkout's test digests and their generation, the derived test_file_status (recomputeFileStatus, its only writer), the collections the page reads, the daily tests.results-cap job, the tests.digestsSettled event (a digest computation ended), the tests.runsIngested event (an ingest pass took in runs with failures), the Tests task category Investigate files under, and the switch of main's test runner (Settings → Config, off by default).",
  register: [resultsCapJob, testDigestsSettled, testRunsIngested],
  contributions: [
    ...testFileStatusServed.declare,
    ...testFileRunsServed.declare,
    ...testCaseFailuresServed.declare,
    TaskCategory({ id: TESTS_CATEGORY_ID, label: "Tests", order: 20 }),
    ConfigV2.Register({ descriptor: testRunnerConfig }),
  ],
} satisfies ServerPluginDefinition;
