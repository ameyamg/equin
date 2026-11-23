import { expect, test } from "bun:test";
import { withHostServices } from "@plugins/framework/plugins/server-core/core/testing";
import { registerPluginJobs } from "@plugins/infra/plugins/jobs/server/testing";
import {
  JobQueue,
  type JobQueueImpl,
  type JobRowOpts,
  type QueuedJob,
} from "@plugins/infra/plugins/jobs/server";
import { fsmonitorReconcileJob, fsmonitorReleaseJob } from "./fsmonitor-job";

test("passes and releases share one serial lane; a release is one pending row per attempt", async () => {
  const rows: { job: QueuedJob; jobKey: JobRowOpts["jobKey"] }[] = [];
  const queue = {
    enqueue: async (job: QueuedJob, _payload: unknown, opts: JobRowOpts) => {
      rows.push({ job, jobKey: opts.jobKey });
      return { jobId: String(rows.length) };
    },
  } as unknown as JobQueueImpl;

  await registerPluginJobs([
    "conversations/plugins/workspace/plugins/worktree",
  ]);
  await withHostServices([JobQueue.provide(queue)], async () => {
    await fsmonitorReconcileJob.enqueue({});
    await fsmonitorReleaseJob.enqueue({ attemptId: "att-1" });
    await fsmonitorReleaseJob.enqueue({ attemptId: "att-2" });
  });

  const [pass, first, second] = rows;
  expect(pass!.job.serial).toBeDefined();
  expect(first!.job.serial).toEqual(pass!.job.serial);
  expect(first!.jobKey).toBe("worktree.fsmonitor-release:att-1");
  expect(second!.jobKey).toBe("worktree.fsmonitor-release:att-2");
});
