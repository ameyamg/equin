import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { sql } from "drizzle-orm";
import {
  createTestDb,
  type TestDb,
} from "@plugins/database/plugins/db-test-fixture/server/testing";
import { runMigrations } from "@plugins/database/plugins/migrations/server/testing";
import { ResourceRefusal } from "@plugins/network/plugins/live/plugins/resource-protocol/core";
import {
  clause,
  type Filter,
} from "@plugins/network/plugins/live/plugins/filter/core";
import {
  createFakeMailProvider,
  type FakeMailProviderOptions,
} from "@plugins/apps/plugins/mail/plugins/provider/server/testing";
import {
  MailUnreachableError,
  nativeMailboxId,
  roleMailboxId,
  threadId,
} from "@plugins/apps/plugins/mail/plugins/provider/core";
import { mailThreads, type MailThreadRow } from "../../core";
import { createMailCache, type MailWindowQuery } from "./engine";

const INBOX = roleMailboxId("inbox");
/** The fake's declared slack in the skew test: twice the 170 s skew it holds, and more. */
const SKEW_SLACK_MS = 360_000;
const ana = { name: "Ana", address: "ana@x.test" };
const bo = { name: "Bo", address: "bo@x.test" };

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb({ prefix: "mail_cache" });
  await runMigrations(t.db);
});
afterAll(async () => {
  await t?.drop();
});
beforeEach(async () => {
  await t.db.execute(sql`delete from mail_accounts`);
});

/** `n` single-message inbox threads, one a minute, newest last: t1 is the oldest. */
function inboxThreads(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i + 1}`,
    messages: [
      {
        id: `m${i + 1}`,
        date: new Date(Date.UTC(2026, 0, 1, 10, i)).toISOString(),
        from: i % 2 ? ana : bo,
        subject: `s${i + 1}`,
      },
    ],
  }));
}

function harness(opts: FakeMailProviderOptions) {
  const f = createFakeMailProvider(opts);
  let notified = 0;
  let mailboxesNotified = 0;
  let statusNotified = 0;
  const notifiedIds: string[][] = [];
  const background: unknown[] = [];
  const cache = createMailCache({
    db: t.db,
    definition: () => f.definition,
    refuse: (code, message) => mailThreads.refuse(code, message),
    notifyThreads: (ids) => {
      notified++;
      if (ids) notifiedIds.push([...ids].sort());
    },
    notifyMailboxes: () => mailboxesNotified++,
    notifyStatus: () => statusNotified++,
    changeSignal: () => ({
      kind: "tick",
      everyMs: 30_000,
      idleEveryMs: 600_000,
      watching: true,
    }),
    onBackgroundError: (_what, err) => background.push(err),
  });
  return {
    f,
    cache,
    notified: () => notified,
    notifiedIds,
    mailboxesNotified: () => mailboxesNotified,
    statusNotified: () => statusNotified,
    background,
    /** The provider calls of `method` since the last `reset()`. */
    count: (method: string) =>
      f.calls.filter((c) => c.method === method).length,
    ids: (method: string) =>
      f.calls.filter((c) => c.method === method).reduce((n, c) => n + c.ids, 0),
    resetCalls: () => f.calls.splice(0),
  };
}

const inbox: Filter = clause("mailboxes", "hasAny", [INBOX]) as Filter;
const win = (
  o: Partial<MailWindowQuery> & { where?: Filter },
): MailWindowQuery => ({
  limit: 3,
  where: inbox,
  ...o,
});
const keyOf = (r: MailThreadRow) => [r.date.toISOString(), r.id] as const;
const ids = (rows: readonly MailThreadRow[]) => rows.map((r) => r.id);

async function settle(h: ReturnType<typeof harness>) {
  await h.cache.settled();
}

async function refusalOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ResourceRefusal) return err.code;
    throw err;
  }
  throw new Error("expected a refusal");
}

describe("mail cache: coverage and fill", () => {
  test("a cold window fills from the head: newest first, only the summaries it places", async () => {
    const h = harness({ threads: inboxThreads(10) });
    const rows = await h.cache.window(win({}));
    expect(ids(rows)).toEqual(["t10", "t9", "t8"]);
    expect(rows[0]!.date.toISOString()).toBe("2026-01-01T10:09:00.000Z");
    expect(h.count("listMessages")).toBe(1);
    // The window's three threads, plus the next one (its date moves the floor past the third).
    expect(h.ids("getThreads")).toBeLessThanOrEqual(25);
    await settle(h);
  });

  test("the next page is a key-range cut: listed from the floor down, no duplicate, no gap", async () => {
    const h = harness({ threads: inboxThreads(10) });
    const first = await h.cache.window(win({}));
    const second = await h.cache.window(win({ after: keyOf(first.at(-1)!) }));
    expect(ids(second)).toEqual(["t7", "t6", "t5"]);
    const third = await h.cache.window(
      win({ after: keyOf(second.at(-1)!), limit: 50 }),
    );
    expect(ids(third)).toEqual(["t4", "t3", "t2", "t1"]);
    await settle(h);
  });

  test("a covered window answers from Postgres: no list, no summary read", async () => {
    const h = harness({ threads: inboxThreads(10) });
    await h.cache.window(win({ limit: 5 }));
    await settle(h);
    h.resetCalls();
    const again = await h.cache.window(win({ limit: 5 }));
    expect(ids(again)).toEqual(["t10", "t9", "t8", "t7", "t6"]);
    expect(h.count("listMessages")).toBe(0);
    expect(h.count("getThreads")).toBe(0);
    await settle(h);
  });

  test("a current cached summary is not read again for another query (the version skip)", async () => {
    const h = harness({ threads: inboxThreads(6) });
    await h.cache.window(win({ limit: 6 }));
    await settle(h);
    h.resetCalls();
    // Another query over the same threads: listed, never re-read.
    const fromAna = await h.cache.window(
      win({ where: clause("from", "contains", "ana") as Filter, limit: 6 }),
    );
    expect(ids(fromAna)).toEqual(["t6", "t4", "t2"]);
    expect(h.count("listMessages")).toBeGreaterThan(0);
    expect(h.count("getThreads")).toBe(0);
    await settle(h);
  });

  test("exhaustion: a window past the end answers what there is, and the next page costs nothing", async () => {
    const h = harness({ threads: inboxThreads(4) });
    const all = await h.cache.window(win({ limit: 50 }));
    expect(ids(all)).toEqual(["t4", "t3", "t2", "t1"]);
    await settle(h);
    h.resetCalls();
    const past = await h.cache.window(
      win({ after: keyOf(all.at(-1)!), limit: 50 }),
    );
    expect(past).toEqual([]);
    expect(h.count("listMessages")).toBe(0);
    await settle(h);
  });

  test("a thread sits at its latest MATCHING message, not its latest message", async () => {
    const h = harness({
      threads: [
        {
          id: "old-unread",
          messages: [
            {
              id: "a",
              date: "2026-01-01T09:00:00Z",
              from: ana,
              subject: "x",
              unread: true,
            },
            {
              id: "b",
              date: "2026-01-01T12:00:00Z",
              from: bo,
              subject: "Re: x",
            },
          ],
        },
        {
          id: "mid-unread",
          messages: [
            {
              id: "c",
              date: "2026-01-01T10:00:00Z",
              from: bo,
              subject: "y",
              unread: true,
            },
          ],
        },
      ],
    });
    const unread = await h.cache.window(
      win({ where: clause("unread", "eq", true) as Filter, limit: 10 }),
    );
    expect(unread.map((r) => [r.id, r.date.toISOString()])).toEqual([
      ["mid-unread", "2026-01-01T10:00:00.000Z"],
      ["old-unread", "2026-01-01T09:00:00.000Z"],
    ]);
    // Read by id, no filter applies: the latest message.
    const [row] = await h.cache.rows(["old-unread"]);
    expect(row!.date.toISOString()).toBe("2026-01-01T12:00:00.000Z");
    await settle(h);
  });

  test("a provider listing slightly out of date order (its own clock) misses nothing across pages", async () => {
    const threads = inboxThreads(60);
    // Every 7th thread is listed as if it came 2 min 50 s after its date —
    // above the next two or three threads in the provider's order. A fill
    // step that ends on one of them would claim coverage down to its date
    // and hide the threads it jumped over: the floor keeps the declared
    // slack above the last placed date. (Wherever the steps end, some skewed
    // thread sits at one of their edges.)
    threads.forEach((t, i) => {
      if (i % 7 === 3) {
        t.messages[0] = { ...t.messages[0]!, providerSkewMs: 170_000 } as never;
      }
    });
    // Several page sizes, each from a cold cache, so the fill's steps end
    // at many different threads.
    for (const limit of [2, 3, 4, 5, 6, 7, 9, 11]) {
      await t.db.execute(sql`delete from mail_accounts`);
      const h = harness({ threads, listOrderSlackMs: SKEW_SLACK_MS });
      const pages: string[] = [];
      let after: MailWindowQuery["after"];
      for (let i = 0; i < 40; i++) {
        const rows = await h.cache.window(win({ limit, after }));
        pages.push(...ids(rows));
        if (rows.length < limit) break;
        after = keyOf(rows.at(-1)!);
      }
      expect([limit, pages]).toEqual([
        limit,
        Array.from({ length: 60 }, (_, i) => `t${60 - i}`),
      ]);
      await settle(h);
    }
  });
});

describe("mail cache: catch-up", () => {
  test("a locally maintained query re-checks changed threads per message: archive leaves, new mail enters", async () => {
    const h = harness({ threads: inboxThreads(4) });
    await h.cache.window(win({ limit: 10 }));
    await settle(h);
    await h.f.provider.archive([threadId("t3")]);
    h.f.deliver("t9", {
      id: "m9",
      date: "2026-01-02T08:00:00Z",
      from: ana,
      subject: "new",
    });
    const before = h.notified();
    await h.cache.catchUp();
    expect(h.notified()).toBeGreaterThan(before);
    h.resetCalls();
    const rows = await h.cache.window(win({ limit: 10 }));
    expect(ids(rows)).toEqual(["t9", "t4", "t2", "t1"]);
    // Answered from the cache: the catch-up kept the inbox itself.
    expect(h.count("listMessages")).toBe(0);
    await settle(h);
  });

  test("a provider-evaluated query a change may have moved answers cached, then re-lists and notifies", async () => {
    const h = harness({ threads: inboxThreads(4) });
    const fromAna = win({
      where: clause("from", "contains", "ana") as Filter,
      limit: 10,
    });
    expect(ids(await h.cache.window(fromAna))).toEqual(["t4", "t2"]);
    await settle(h);
    h.f.deliver(null, {
      id: "m7",
      date: "2026-01-02T08:00:00Z",
      from: ana,
      subject: "hi",
    });
    await h.cache.catchUp();
    // Unverified: the read answers what it holds…
    const stale = await h.cache.window(fromAna);
    expect(ids(stale)).toEqual(["t4", "t2"]);
    const before = h.notified();
    // …and the re-list it started brings the new thread.
    await settle(h);
    await new Promise((r) => setTimeout(r, 50));
    const fresh = await h.cache.window(fromAna);
    expect(fresh.length).toBe(3);
    expect(h.notified()).toBeGreaterThan(before);
    await settle(h);
  });

  test("a reset marks every summary stale and every query unverified, then re-lists", async () => {
    const h = harness({ threads: inboxThreads(3) });
    await h.cache.window(win({ limit: 10 }));
    await settle(h);
    h.f.expireHistory();
    await h.cache.catchUp();
    const [q] = (
      await t.db.execute(sql`select verified_cursor from mail_queries`)
    ).rows as {
      verified_cursor: string | null;
    }[];
    expect(q!.verified_cursor).toBeNull();
    const stale = (
      await t.db.execute(
        sql`select count(*)::int as n from mail_threads where stale`,
      )
    ).rows[0] as { n: number };
    expect(stale.n).toBe(3);
    // Still answered, from the cache.
    expect(ids(await h.cache.window(win({ limit: 10 })))).toEqual([
      "t3",
      "t2",
      "t1",
    ]);
    await settle(h);
  });
});

describe("mail cache: the sync step (the change signal's entry)", () => {
  const unread: Filter = clause("unread", "eq", true) as Filter;

  test("an account never read has nothing to sync: no provider call, no account made", async () => {
    const h = harness({ threads: inboxThreads(3) });
    await h.cache.sync();
    expect(h.f.calls).toEqual([]);
    expect(await h.cache.status()).toEqual({ kind: "none" });
  });

  test("a tick with no read applies the changes, notifies the changed threads and refreshes the counts", async () => {
    const h = harness({ threads: inboxThreads(4) });
    await h.cache.window(win({ limit: 10 }));
    await settle(h);
    const boxes = h.mailboxesNotified();
    await h.f.provider.archive([threadId("t2")]);
    h.f.deliver("t9", {
      id: "m9",
      date: "2026-01-02T08:00:00Z",
      from: ana,
      subject: "new",
    });
    h.notifiedIds.splice(0);
    h.resetCalls();
    await h.cache.sync();
    expect(h.notifiedIds).toEqual([["t2", "t9"]]);
    // The mailbox counts moved with them: relisted, notified.
    expect(h.count("listMailboxes")).toBe(1);
    expect(h.mailboxesNotified()).toBeGreaterThan(boxes);
    h.resetCalls();
    expect(ids(await h.cache.window(win({ limit: 10 })))).toEqual([
      "t9",
      "t4",
      "t3",
      "t1",
    ]);
    expect(h.count("listMessages")).toBe(0);
    await settle(h);
    // A tick where nothing moved: one change read, nothing re-read or notified.
    h.resetCalls();
    const before = h.notified();
    await h.cache.sync();
    expect(h.f.calls.map((c) => c.method)).toEqual(["changesSince"]);
    expect(h.notified()).toBe(before);
  });

  test("unread is kept per message: read leaves the Unread view, marked unread enters it", async () => {
    const h = harness({
      threads: inboxThreads(3).map((t) => ({
        ...t,
        messages: t.messages.map((m) => ({ ...m, unread: true })),
      })),
    });
    const view = win({ where: unread, limit: 10 });
    expect(ids(await h.cache.window(view))).toEqual(["t3", "t2", "t1"]);
    await settle(h);
    await h.f.provider.setFlags([threadId("t2")], { unread: false });
    await h.cache.sync();
    h.resetCalls();
    expect(ids(await h.cache.window(view))).toEqual(["t3", "t1"]);
    expect(h.count("listMessages")).toBe(0);
    await settle(h);
    await h.f.provider.setFlags([threadId("t2")], { unread: true });
    await h.cache.sync();
    h.resetCalls();
    expect(ids(await h.cache.window(view))).toEqual(["t3", "t2", "t1"]);
    expect(h.count("listMessages")).toBe(0);
    await settle(h);
  });

  test("a step failing after it applied changes still notifies them, and keeps the cursor so the next step re-reads the page", async () => {
    const h = harness({ threads: inboxThreads(3) });
    await h.cache.window(win({ limit: 10 }));
    await settle(h);
    await h.f.provider.archive([threadId("t1")]);
    h.f.failNext("listMailboxes", new Error("labels down"));
    h.notifiedIds.splice(0);
    await h.cache.sync();
    expect(h.notifiedIds).toEqual([["t1"]]);
    expect(h.background.length).toBe(1);
    h.resetCalls();
    await h.cache.sync();
    // The page is read again: the counts relisted this time.
    expect(h.count("listMailboxes")).toBe(1);
    expect(await h.cache.status()).toMatchObject({ syncFailure: null });
  });

  test("a burst of signals folds: one step running, one trailing", async () => {
    const h = harness({ threads: inboxThreads(2) });
    await h.cache.window(win({ limit: 10 }));
    await settle(h);
    h.resetCalls();
    await Promise.all(Array.from({ length: 8 }, () => h.cache.sync()));
    expect(h.count("changesSince")).toBeLessThanOrEqual(2);
    expect(h.count("changesSince")).toBeGreaterThanOrEqual(1);
  });

  test("a reset from a tick re-reads what a view holds on its next read", async () => {
    const h = harness({ threads: inboxThreads(3) });
    await h.cache.window(win({ limit: 10 }));
    await settle(h);
    h.f.expireHistory();
    const before = h.notified();
    await h.cache.sync();
    expect(h.notified()).toBeGreaterThan(before);
    await h.f.provider.archive([threadId("t3")]);
    // The read answers the cache, the re-list it starts fixes it.
    await h.cache.window(win({ limit: 10 }));
    await settle(h);
    await new Promise((r) => setTimeout(r, 50));
    expect(ids(await h.cache.window(win({ limit: 10 })))).toEqual(["t2", "t1"]);
    await settle(h);
  });

  test("the status: synced, an offline step recorded (not reported), a fault recorded and reported, not connected recorded, each cleared by a success", async () => {
    const h = harness({ threads: inboxThreads(2) });
    await h.cache.window(win({ limit: 10 }));
    await settle(h);
    const synced = await h.cache.status();
    expect(synced).toMatchObject({
      kind: "account",
      address: "fake@example.com",
      connection: "connected",
      syncFailure: null,
    });
    expect(synced.kind === "account" && synced.syncedAt).toBeTruthy();
    const pushed = h.statusNotified();
    h.f.failNext(
      "changesSince",
      new MailUnreachableError("history", new Error("ENETDOWN")),
    );
    await h.cache.sync();
    expect(h.statusNotified()).toBeGreaterThan(pushed);
    expect(await h.cache.status()).toMatchObject({
      syncFailure: { kind: "offline" },
    });
    expect(h.background).toEqual([]);
    h.f.failNext("changesSince", new Error("boom"));
    await h.cache.sync();
    expect(await h.cache.status()).toMatchObject({
      syncFailure: { kind: "fault", message: "boom" },
    });
    expect(h.background.length).toBe(1);
    await h.cache.sync();
    expect(await h.cache.status()).toMatchObject({ syncFailure: null });
    // The connection as the last step found it: a revocation is recorded by
    // the next step, a reconnect cleared by the one after.
    h.f.setConnected(false);
    await h.cache.sync();
    expect(await h.cache.status()).toMatchObject({
      kind: "not-connected",
      address: "fake@example.com",
    });
    expect(h.background.length).toBe(1);
    h.f.setConnected(true);
    await h.cache.sync();
    expect(await h.cache.status()).toMatchObject({
      kind: "account",
      syncFailure: null,
    });
  });
});

describe("mail cache: re-list", () => {
  test("a re-list that stops mid-way through the list's last page never marks the query exhausted", async () => {
    // 80 threads from Ana: one list page (100 messages) holds them all.
    const threads = Array.from({ length: 80 }, (_, i) => ({
      id: `a${String(i + 1).padStart(2, "0")}`,
      messages: [
        {
          id: `am${i + 1}`,
          date: new Date(Date.UTC(2026, 0, 1, 10, i)).toISOString(),
          from: ana,
          subject: `s${i + 1}`,
        },
      ],
    }));
    const h = harness({ threads });
    const fromAna = (limit: number, after?: MailWindowQuery["after"]) =>
      win({ where: clause("from", "contains", "ana") as Filter, limit, after });
    await h.cache.window(fromAna(10));
    await settle(h);
    h.f.deliver(null, {
      id: "new",
      date: "2026-01-02T08:00:00Z",
      from: ana,
      subject: "new",
    });
    await h.cache.catchUp();
    await h.cache.window(fromAna(10)); // unverified: starts the re-list
    const query_id = (
      (await t.db.execute(sql`select query_id from mail_queries`)).rows[0] as {
        query_id: number;
      }
    ).query_id;
    await h.cache.relistSettled(query_id);
    const exhausted = (
      (await t.db.execute(sql`select exhausted from mail_queries`)).rows[0] as {
        exhausted: boolean;
      }
    ).exhausted;
    expect(exhausted).toBe(false);
    // Every thread still reachable, page by page.
    const all: string[] = [];
    let after: MailWindowQuery["after"];
    for (let i = 0; i < 10; i++) {
      const rows = await h.cache.window(fromAna(20, after));
      all.push(...ids(rows));
      if (rows.length < 20) break;
      after = keyOf(rows.at(-1)!);
    }
    expect(all.length).toBe(81);
    await settle(h);
  });
});

describe("mail cache: refusals", () => {
  test("not connected", async () => {
    const h = harness({ threads: inboxThreads(2) });
    h.f.setConnected(false);
    expect(await refusalOf(h.cache.window(win({})))).toBe("not-connected");
    expect(await refusalOf(h.cache.rows(["t1"]))).toBe("not-connected");
  });

  test("offline: an uncovered window is refused, a covered one still answers", async () => {
    const h = harness({ threads: inboxThreads(5) });
    await h.cache.window(win({ limit: 2 }));
    await settle(h);
    h.f.failNext(
      "listMessages",
      new MailUnreachableError("messages.list", new Error("ENETDOWN")),
    );
    expect(await refusalOf(h.cache.window(win({ limit: 50 })))).toBe(
      "offline-not-cached",
    );
    h.f.failNext(
      "changesSince",
      new MailUnreachableError("history", new Error("ENETDOWN")),
    );
    expect(ids(await h.cache.window(win({ limit: 2 })))).toEqual(["t5", "t4"]);
    await settle(h);
    // Offline in the background is not a failure to report.
    expect(h.background).toEqual([]);
  });

  test("offline, the connection uncheckable: the stored account still answers what is covered", async () => {
    const h = harness({ threads: inboxThreads(5) });
    await h.cache.window(win({ limit: 2 }));
    await settle(h);
    h.f.setConnected("unreachable");
    expect(ids(await h.cache.window(win({ limit: 2 })))).toEqual(["t5", "t4"]);
    h.f.failNext(
      "listMessages",
      new MailUnreachableError("messages.list", new Error("ENETDOWN")),
    );
    expect(await refusalOf(h.cache.window(win({ limit: 50 })))).toBe(
      "offline-not-cached",
    );
    expect((await h.cache.mailboxes()).length).toBeGreaterThan(0);
    await settle(h);
    // Nothing cached at all: refused, typed.
    await t.db.execute(sql`delete from mail_accounts`);
    expect(await refusalOf(h.cache.mailboxes())).toBe("offline-not-cached");
  });

  test("a rule the provider cannot run is refused, never dropped", async () => {
    const h = harness({ threads: inboxThreads(2) });
    expect(
      await refusalOf(
        h.cache.window(
          win({
            where: clause("mailboxes", "hasAny", [
              nativeMailboxId("Label_404"),
            ]) as Filter,
          }),
        ),
      ),
    ).toBe("filter-refused");
  });

  test("another address on the same account id is another mailbox: its cache is dropped", async () => {
    const h = harness({ threads: inboxThreads(2) });
    await h.cache.window(win({}));
    await settle(h);
    const other = harness({
      threads: inboxThreads(1),
      account: {
        accountId: "fake-account",
        address: "someone-else@example.com",
      },
    });
    expect(ids(await other.cache.window(win({})))).toEqual(["t1"]);
    await settle(other);
  });
});

describe("mail cache: held (the boot preload's cache-only answer)", () => {
  test("answers a covered window as window() does, with no provider call; anything else is not held", async () => {
    const h = harness({ threads: inboxThreads(5) });
    // Nothing cached: not held, and nothing asked of the provider.
    expect(await h.cache.held(win({ limit: 2 }))).toEqual({ held: false });
    expect(h.f.calls).toEqual([]);

    const covered = await h.cache.window(win({ limit: 2 }));
    await settle(h);
    h.resetCalls();
    expect(await h.cache.held(win({ limit: 2 }))).toEqual({
      held: true,
      rows: covered,
    });
    // Past coverage, or another query: not held (window() would fill).
    expect(await h.cache.held(win({ limit: 5 }))).toEqual({ held: false });
    expect(
      await h.cache.held(
        win({ limit: 2, where: clause("unread", "eq", true) as Filter }),
      ),
    ).toEqual({ held: false });
    expect(h.f.calls).toEqual([]);

    // The connection is never checked: held answers even when it cannot be.
    h.f.setConnected("unreachable");
    expect(await h.cache.held(win({ limit: 2 }))).toEqual({
      held: true,
      rows: covered,
    });
    expect(h.f.calls).toEqual([]);
  });
});

test("held writes nothing (a boot preload is not a use)", async () => {
  const h = harness({ threads: inboxThreads(3) });
  await h.cache.window(win({ limit: 2 }));
  await settle(h);
  await t.db.execute(
    sql`update mail_threads set last_used_at = '2026-01-01T00:00:00Z'`,
  );
  expect((await h.cache.held(win({ limit: 2 }))).held).toBe(true);
  const r = await t.db.execute(
    sql`select count(*)::int as n from mail_threads where last_used_at <> '2026-01-01T00:00:00Z'`,
  );
  expect((r.rows[0] as { n: number }).n).toBe(0);
});
