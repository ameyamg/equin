/**
 * The delivery ledger on real Postgres (the real migration chain): a row is
 * news only when the site's last sighting or count grew, never twice for the
 * same facts, and the facts never move back.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import {
  createTestDb,
  type TestDb,
} from "@plugins/database/plugins/db-test-fixture/server/testing";
import { runMigrations } from "@plugins/database/plugins/migrations/server/testing";
import { siteReportLedger } from "./ledger";
import { siteReportImports } from "./tables";

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb({ prefix: "site_report_ledger" });
  await runMigrations(t.db);
});

afterAll(async () => {
  await t.drop();
});

beforeEach(async () => {
  await t.db.delete(siteReportImports);
});

const at = (d: string) => `2026-11-${d}T00:00:00.000Z`;
const occ = (fp: string, day: string, siteCount = 1) => ({
  siteFingerprint: fp,
  lastSeenAt: at(day),
  siteCount,
});

async function admit(rows: ReturnType<typeof occ>[], dep = "dpl-1") {
  return await t.db.transaction(async (tx) =>
    [...(await siteReportLedger.admit(tx, dep, rows))].sort(),
  );
}

describe("siteReportLedger", () => {
  test("first sight is news; the same facts again are not", async () => {
    expect(await admit([occ("a", "12"), occ("b", "12")])).toEqual(["a", "b"]);
    expect(await admit([occ("a", "12"), occ("b", "12")])).toEqual([]);
  });

  test("a later sighting or a higher count is news", async () => {
    await admit([occ("a", "12"), occ("b", "12")]);
    expect(await admit([occ("a", "13"), occ("b", "12", 2)])).toEqual([
      "a",
      "b",
    ]);
  });

  test("an older copy is not news and does not move the facts back", async () => {
    await admit([occ("a", "13", 3)]);
    expect(await admit([occ("a", "12", 2)])).toEqual([]);
    const [row] = await t.db.select().from(siteReportImports);
    expect(row!.lastSeenAt.toISOString()).toBe(at("13"));
    expect(row!.siteCount).toBe(3);
  });

  test("deployments are apart, and a forgotten fingerprint is news again", async () => {
    await admit([occ("a", "12")]);
    expect(await admit([occ("a", "12")], "dpl-2")).toEqual(["a"]);
    await t.db.transaction((tx) => siteReportLedger.forget(tx, "dpl-1", ["a"]));
    expect(await admit([occ("a", "12")])).toEqual(["a"]);
  });
});
