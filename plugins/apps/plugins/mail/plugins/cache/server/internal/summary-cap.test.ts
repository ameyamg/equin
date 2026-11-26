import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  createTestDb,
  type TestDb,
} from "@plugins/database/plugins/db-test-fixture/server/testing";
import { runMigrations } from "@plugins/database/plugins/migrations/server/testing";
import { executeRows } from "@plugins/database/plugins/sql-rows/core";
import {
  clause,
  type Filter,
} from "@plugins/network/plugins/live/plugins/filter/core";
import { createFakeMailProvider } from "@plugins/apps/plugins/mail/plugins/provider/server/testing";
import { roleMailboxId } from "@plugins/apps/plugins/mail/plugins/provider/core";
import { mailThreads, type MailThreadRow } from "../../core";
import { createMailCache, type MailWindowQuery } from "./engine";

// The summary cap (design §3: LRU, ~50k): threads no query holds go first,
// then the least recently used a query holds, its coverage cut back above
// them — on a throwaway database over the fake provider.

const INBOX = roleMailboxId("inbox");
const ana = { name: "Ana", address: "ana@x.test" };

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb({ prefix: "mail_summary_cap" });
  await runMigrations(t.db);
});
afterAll(async () => {
  await t?.drop();
});
beforeEach(async () => {
  await t.db.execute(sql`delete from mail_accounts`);
});

/** `n` single-message threads, one a minute, newest last; `t1`, `t2` not in the Inbox. */
function threads(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i + 1}`,
    messages: [
      {
        id: `m${i + 1}`,
        date: new Date(Date.UTC(2026, 0, 1, 10, i)).toISOString(),
        from: ana,
        subject: `s${i + 1}`,
        ...(i < 2 ? { mailboxes: [] } : {}),
      },
    ],
  }));
}

function harness(n: number) {
  const f = createFakeMailProvider({ threads: threads(n) });
  let cap = 1_000_000;
  const background: unknown[] = [];
  const cache = createMailCache({
    db: t.db,
    definition: () => f.definition,
    refuse: (code, message) => mailThreads.refuse(code, message),
    notifyThreads: () => {},
    notifyMailboxes: () => {},
    notifyStatus: () => {},
    changeSignal: () => ({
      push: { kind: "none" },
      everyMs: 30_000,
      idleEveryMs: null,
      watching: true,
      ticking: true,
    }),
    onBackgroundError: (_what, err) => background.push(err),
    enqueueOp: async () => {},
    summaryCap: () => cap,
  });
  return {
    f,
    cache,
    background,
    setCap: (c: number) => {
      cap = c;
    },
    count: (method: string) =>
      f.calls.filter((c) => c.method === method).length,
    resetCalls: () => f.calls.splice(0),
  };
}

const inbox: Filter = clause("mailboxes", "hasAny", [INBOX]) as Filter;
const win = (limit: number): MailWindowQuery => ({ limit, where: inbox });
const ids = (rows: readonly MailThreadRow[]) => rows.map((r) => r.id);

async function stored(): Promise<string[]> {
  const rows = await executeRows(t.db, {
    query: sql`select thread_id from mail_threads order by thread_id`,
    row: z.object({ thread_id: z.string() }),
  });
  return rows.map((r) => r.thread_id).sort();
}

async function members(): Promise<string[]> {
  const rows = await executeRows(t.db, {
    query: sql`select thread_id from mail_query_members`,
    row: z.object({ thread_id: z.string() }),
  });
  return rows.map((r) => r.thread_id).sort();
}

/** Every summary last used and fetched a day ago, minus `order`'s index in minutes: the first listed is the least recently used. */
async function age(order: readonly string[]) {
  await t.db.execute(
    sql`update mail_threads set last_used_at = now() - interval '1 day', fetched_at = now() - interval '1 day'`,
  );
  for (const [i, id] of order.entries()) {
    await t.db.execute(
      sql`update mail_threads set last_used_at = now() - interval '2 days' + make_interval(mins => ${i}) where thread_id = ${id}`,
    );
  }
}

/** The Inbox's first 4 (t10…t7) held by its query, and t1, t2 read alone (no query holds them). */
async function seeded(h: ReturnType<typeof harness>) {
  expect(ids(await h.cache.window(win(4)))).toEqual(["t10", "t9", "t8", "t7"]);
  await h.cache.settled();
  await h.cache.thread("t1");
  await h.cache.thread("t2");
  await h.cache.settled();
}

describe("mail cache: the summary cap", () => {
  test("under the cap, nothing goes", async () => {
    const h = harness(10);
    await seeded(h);
    const before = await stored();
    await age([]);
    await h.cache.enforceSummaryCap();
    expect(await stored()).toEqual(before);
  });

  test("threads no query holds go first, least recently used first; the view still answers from the cache", async () => {
    const h = harness(10);
    await seeded(h);
    const before = await stored();
    // t9 is the least recently used, but a query holds it.
    await age(["t9", "t2", "t1"]);
    h.setCap(before.length - 1);
    await h.cache.enforceSummaryCap();
    expect(await stored()).toEqual(before.filter((id) => id !== "t2"));
    h.setCap(before.length - 2);
    await h.cache.enforceSummaryCap();
    expect(await stored()).toEqual(
      before.filter((id) => id !== "t2" && id !== "t1"),
    );
    h.resetCalls();
    expect(ids(await h.cache.window(win(4)))).toEqual([
      "t10",
      "t9",
      "t8",
      "t7",
    ]);
    expect(h.count("listMessages")).toBe(0);
    expect(h.background).toEqual([]);
  });

  test("past them, a held thread goes with its query's coverage cut back above it: the head answers cached, below it fills again", async () => {
    const h = harness(10);
    await seeded(h);
    const held = await members();
    // t8 is the least recently used a query holds: its query keeps t10, t9.
    await age(["t2", "t1", "t8"]);
    h.setCap(held.length - 1);
    await h.cache.enforceSummaryCap();
    expect(await members()).toEqual(["t10", "t9"]);
    expect(await stored()).not.toContain("t8");
    h.resetCalls();
    expect(ids(await h.cache.window(win(2)))).toEqual(["t10", "t9"]);
    expect(h.count("listMessages")).toBe(0);
    expect(ids(await h.cache.window(win(4)))).toEqual([
      "t10",
      "t9",
      "t8",
      "t7",
    ]);
    expect(h.count("listMessages")).toBeGreaterThan(0);
    await h.cache.settled();
    expect(h.background).toEqual([]);
  });

  test("the most recent held thread evicted takes the whole coverage: the view refills from the head", async () => {
    const h = harness(10);
    await seeded(h);
    const all = await stored();
    await age(["t2", "t1", "t10"]);
    h.setCap(all.length - 3);
    await h.cache.enforceSummaryCap();
    expect(await members()).toEqual([]);
    h.resetCalls();
    expect(ids(await h.cache.window(win(4)))).toEqual([
      "t10",
      "t9",
      "t8",
      "t7",
    ]);
    expect(h.count("listMessages")).toBeGreaterThan(0);
    await h.cache.settled();
  });

  test("a cached summary a fill is placing is never deleted under it, even old and held by no query yet", async () => {
    const h = harness(10);
    // t3 cached alone (no query holds it), and old.
    await h.cache.thread("t3");
    await h.cache.settled();
    await age(["t3"]);
    // A cold Inbox fill reuses t3's summary and waits on the provider for
    // the others' — the sweep runs in that gap.
    const paused = h.f.holdNext("getThreads", "foreground");
    const filling = h.cache.window(win(10));
    await paused.reached;
    h.setCap(0);
    await h.cache.enforceSummaryCap();
    expect(await stored()).toContain("t3");
    paused.release();
    expect(ids(await filling)).toEqual([
      "t10",
      "t9",
      "t8",
      "t7",
      "t6",
      "t5",
      "t4",
      "t3",
    ]);
    await h.cache.settled();
    expect(h.background).toEqual([]);
  });

  test("a summary fetched or used in the last minutes is never evicted, even over the cap", async () => {
    const h = harness(10);
    await seeded(h);
    const before = await stored();
    h.setCap(1);
    await h.cache.enforceSummaryCap();
    expect(await stored()).toEqual(before);
  });
});
