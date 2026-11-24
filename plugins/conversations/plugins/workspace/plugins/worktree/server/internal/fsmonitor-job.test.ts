import { partialFake } from "@plugins/framework/plugins/tooling/plugins/test-layout/core/testing";
import { expect, test } from "bun:test";
import { withHostServices } from "@plugins/framework/plugins/server-core/core/testing";
import { registerPluginJobs } from "@plugins/infra/plugins/jobs/server/testing";
import {
  JobQueue,
  type JobQueueImpl,
  type JobRowOpts,
  type QueuedJob,
} from "@plugins/infra/plugins/jobs/server";
import {
  fsmonitorOnReadJob,
  fsmonitorReconcileJob,
  fsmonitorReleaseJob,
} from "./fsmonitor-job";

test("passes, releases and reads share one serial lane; each per-checkout job is one pending row per attempt", async () => {
  const rows: { job: QueuedJob; jobKey: JobRowOpts["jobKey"] }[] = [];
  const queue = partialFake<JobQueueImpl>("JobQueueImpl", {
    enqueue: async (job: QueuedJob, _payload: unknown, opts: JobRowOpts) => {
      rows.push({ job, jobKey: opts.jobKey });
      return { jobId: String(rows.length) };
    },
  });

  await registerPluginJobs([
    "conversations/plugins/workspace/plugins/worktree",
  ]);
  await withHostServices([JobQueue.provide(queue)], async () => {
    await fsmonitorReconcileJob.enqueue({});
    await fsmonitorReleaseJob.enqueue({ attemptId: "att-1" });
    await fsmonitorReleaseJob.enqueue({ attemptId: "att-2" });
    await fsmonitorOnReadJob.enqueue({ attemptId: "att-1" });
  });

  const [pass, first, second, read] = rows;
  expect(pass!.job.serial).toBeDefined();
  expect(first!.job.serial).toEqual(pass!.job.serial);
  expect(first!.jobKey).toBe("worktree.fsmonitor-release:att-1");
  expect(second!.jobKey).toBe("worktree.fsmonitor-release:att-2");
  expect(read!.job.serial).toEqual(pass!.job.serial);
  expect(read!.jobKey).toBe("worktree.fsmonitor-on-read:att-1");
});
