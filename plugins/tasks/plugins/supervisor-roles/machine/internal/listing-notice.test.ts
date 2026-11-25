// The listing notice is sent once per settled edit, not once per keystroke.
//
// The incident (2026-11-25): typing a role's description ("" → "B" → "Bu")
// saved on every keystroke, each save emitted `supervisorRoles.listingChanged`,
// and every running supervisor got one event turn per save. The job is now
// settled on one key, so a burst folds into ONE row, due once edits stop.
//
// The suite queues the REAL job (its own dedup spec) on the in-process queue
// over an in-memory row store; the row runner is a stand-in that records each
// run — what the job does inside a run (render the section from the roles as
// they are then) needs a live agent and is not this suite's concern.

import { afterEach, beforeAll, expect, test } from "bun:test";
import { withHostServices } from "@plugins/framework/plugins/server-core/core/testing";
import { JobQueue } from "@plugins/infra/plugins/jobs/server";
import { registerPluginJobs } from "@plugins/infra/plugins/jobs/server/testing";
import { settleJobQueue } from "@plugins/infra/plugins/jobs/plugins/in-process/server";
import {
  createInProcessQueue,
  memoryRowStore,
} from "@plugins/infra/plugins/jobs/plugins/in-process/server/testing";
import { onListingChangedJob } from "./listing-notice";

beforeAll(async () => {
  await registerPluginJobs(["tasks/plugins/supervisor-roles"]);
});

const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

test("three quick listing changes give one notice, due once the edits settle", async () => {
  const ran: unknown[] = [];
  const queue = createInProcessQueue({
    store: memoryRowStore(),
    runRow: async (payload) => {
      ran.push(payload.event);
      return { kind: "completed" };
    },
  });
  await queue.start();
  stops.push(() => queue.stop());

  await withHostServices([JobQueue.provide(queue)], async () => {
    // Three saves of one description, as the editor sends them while typing.
    const ids: string[] = [];
    for (const roleId of ["role-a", "role-a", "role-a"]) {
      const { jobId } = await onListingChangedJob.enqueue(
        {},
        { _event: { roleId } },
      );
      ids.push(jobId);
    }
    const lastEdit = Date.now();

    // One pending row holds them all, due a quiet window after the last.
    const pending = await queue.rows(ids);
    expect(pending).toHaveLength(1);
    const [row] = pending;
    expect(row!.runAt!.getTime()).toBeGreaterThanOrEqual(lastEdit + 4_000);

    // Time passes: the row runs, once.
    await settleJobQueue();
    expect(ran).toHaveLength(1);
  });
});

test("a change to another role in the same burst folds in too", async () => {
  const queue = createInProcessQueue({
    store: memoryRowStore(),
    runRow: async () => ({ kind: "completed" }),
  });
  await queue.start();
  stops.push(() => queue.stop());

  await withHostServices([JobQueue.provide(queue)], async () => {
    const a = await onListingChangedJob.enqueue(
      {},
      { _event: { roleId: "a" } },
    );
    const b = await onListingChangedJob.enqueue(
      {},
      { _event: { roleId: "b" } },
    );
    // The section lists every role: one re-send covers both.
    expect(await queue.rows([a.jobId, b.jobId])).toHaveLength(1);
  });
});
