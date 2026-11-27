/**
 * Suite for standing conditions (`syncStandingConditions`) against a
 * throwaway Postgres seeded with the REAL migration chain: a condition is
 * filed once while it stands, closed (its uninvestigated report deleted) once
 * the audit no longer sees it, filed again when it comes back — and a report
 * someone took up is kept, the condition coming back landing on it again.
 *
 * Run: `./equin test plugins/reports/plugins/engine`
 * (requires the running embedded cluster — `./equin build` first).
 */

import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "bun:test";
import { eq, sql } from "drizzle-orm";
import {
  createTestDb,
  type TestDb,
} from "@plugins/database/plugins/db-test-fixture/server/testing";
import { runMigrations } from "@plugins/database/plugins/migrations/server/testing";
import { mountProducersForTest } from "@plugins/network/plugins/live/plugins/change-feed/server/testing";
import { _reports } from "@plugins/reports/server";
import { reportIdKind, type ReportInput } from "@plugins/reports/core";
import { writeReport, type RecordReportResult } from "./record-report";
import { reportsProducer } from "./producer";
import { linkReportTask } from "./investigate";
import { _reportStandingConditions } from "./tables";
import {
  syncStandingConditions,
  type StandingCondition,
} from "./standing-report";

const KIND = "standing-test";
const WT = "wt-test";

let seq = 0;

describe("syncStandingConditions (real DB)", () => {
  let t: TestDb;
  let unmount: () => void;
  let filedInputs: string[] = [];

  beforeAll(async () => {
    t = await createTestDb({ prefix: "standing_report_test" });
    await runMigrations(t.db);
    unmount = mountProducersForTest([reportsProducer], { route: () => {} });
  });

  afterAll(async () => {
    unmount();
    await t.drop();
  });

  beforeEach(async () => {
    // Fixture setup on a throwaway database no reader subscribes to.
    await t.db.execute(sql`DELETE FROM reports`);
    filedInputs = [];
  });

  const condition = (key: string): StandingCondition => ({
    fingerprint: `${KIND}:${key}`,
    input: {
      kind: KIND,
      source: "server-config-audit",
      message: key,
      data: {},
    },
  });

  // Files like recordReport does: an upsert on (fingerprint, worktree).
  const file = async (input: ReportInput): Promise<RecordReportResult> => {
    filedInputs.push(input.message ?? "");
    const [row] = await writeReport(
      {
        id: reportIdKind.key(`report-standing-test-${seq++}`),
        kind: KIND,
        fingerprint: `${KIND}:${input.message}`,
        worktree: WT,
        source: "server-config-audit",
        message: input.message ?? "",
        url: null,
        userAgent: null,
        data: {},
        limited: false,
        noise: { ifSkew: false, ifLive: false },
        staleOrigin: false,
        skewProven: false,
        clientId: null,
        buildId: null,
        commit: null,
        occurredAt: new Date(),
        occurrences: 1,
        afterWake: null,
      },
      t.db,
    );
    return {
      outcome: "recorded",
      reportId: row!.id,
      taskId: row!.taskId,
      rateLimited: false,
    };
  };

  const sync = (keys: string[]) =>
    syncStandingConditions(t.db, {
      kind: KIND,
      worktree: WT,
      conditions: keys.map(condition),
      file,
    });

  const row = async (key: string) =>
    (
      await t.db
        .select()
        .from(_reports)
        .where(eq(_reports.fingerprint, `${KIND}:${key}`))
    )[0];

  test("a standing condition is filed once, however often the audit looks", async () => {
    await sync(["a"]);
    const again = await sync(["a"]);
    expect(again.standing).toEqual([`${KIND}:a`]);
    expect(again.filed).toEqual([]);
    expect(filedInputs).toEqual(["a"]);
    expect((await row("a"))?.count).toBe(1);
  });

  test("a condition gone closes its uninvestigated report; coming back files it again", async () => {
    await sync(["a", "b"]);
    const cleared = await sync(["b"]);
    expect(cleared.cleared).toEqual([
      expect.objectContaining({ fingerprint: `${KIND}:a`, closed: true }),
    ]);
    expect(await row("a")).toBeUndefined();
    expect(await row("b")).toBeDefined();

    const back = await sync(["a", "b"]);
    expect(back.filed.map((f) => f.fingerprint)).toEqual([`${KIND}:a`]);
    expect((await row("a"))?.count).toBe(1);
  });

  test("a report someone took up stays, and the condition coming back is a new occurrence of it", async () => {
    await sync(["a"]);
    // Investigate's write, without the task machinery.
    await linkReportTask(t.db, (await row("a"))!.id, "task-standing-test");

    const cleared = await sync([]);
    expect(cleared.cleared).toEqual([
      expect.objectContaining({ fingerprint: `${KIND}:a`, closed: false }),
    ]);
    expect(await row("a")).toBeDefined();
    expect(
      await t.db
        .select()
        .from(_reportStandingConditions)
        .where(eq(_reportStandingConditions.worktree, WT)),
    ).toEqual([]);

    await sync(["a"]);
    expect(filedInputs).toEqual(["a", "a"]);
    expect((await row("a"))?.count).toBe(2);
  });

  test("a report retention swept takes its standing row, so a condition still there is filed again", async () => {
    await sync(["a"]);
    await t.db.execute(sql`DELETE FROM reports`);
    const again = await sync(["a"]);
    expect(again.filed.map((f) => f.fingerprint)).toEqual([`${KIND}:a`]);
  });
});
