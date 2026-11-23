/**
 * The announcement gate (`announceRecorded`) over the one owner definition
 * (`reportHasLiveOwner`), with a fake tasks answer: a report whose linked task
 * was dropped is announced again on its next occurrence; one whose task is
 * live is still skipped.
 *
 * Run: `./equin test plugins/reports/plugins/engine`
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { collectContributions } from "@plugins/framework/plugins/server-core/core";
import { clearCollectedContributions } from "@plugins/framework/plugins/server-core/core/testing";
import { ReportRecorded, reportOwnerSink } from "@plugins/reports/server";
import { announceRecorded } from "./recorded";

const announced: string[] = [];
// The fake tasks domain: the ids of the tasks that are live (not dropped).
const live = new Set<string>();

describe("announceRecorded", () => {
  beforeAll(() => {
    collectContributions([
      {
        id: "test/recorded",
        contributions: [
          ReportRecorded({
            id: "test/recorded",
            onRecorded: (id) => announced.push(id),
          }),
        ],
      },
    ]);
    reportOwnerSink.register(({ taskId }) => Promise.resolve(live.has(taskId)));
  });
  afterAll(() => {
    reportOwnerSink.register(null);
    clearCollectedContributions();
  });
  beforeEach(() => {
    announced.length = 0;
    live.clear();
  });

  test("a report with no linked task is announced", async () => {
    await announceRecorded({ id: "r1", taskId: null, noise: false });
    expect(announced).toEqual(["r1"]);
  });

  test("a report whose task is live is skipped", async () => {
    live.add("task-live");
    await announceRecorded({ id: "r2", taskId: "task-live", noise: false });
    expect(announced).toEqual([]);
  });

  test("once its task is dropped, the report's next occurrence is announced", async () => {
    live.add("task-x");
    await announceRecorded({ id: "r3", taskId: "task-x", noise: false });
    expect(announced).toEqual([]);
    live.delete("task-x"); // dropped: the link stays, the owner is gone
    await announceRecorded({ id: "r3", taskId: "task-x", noise: false });
    expect(announced).toEqual(["r3"]);
  });

  test("noise is never announced, owned or not", async () => {
    await announceRecorded({ id: "r4", taskId: null, noise: true });
    expect(announced).toEqual([]);
  });
});
