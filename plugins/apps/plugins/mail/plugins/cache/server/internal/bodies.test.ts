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
import {
  MailUnreachableError,
  roleMailboxId,
  threadId,
} from "@plugins/apps/plugins/mail/plugins/provider/core";
import { mailThreads } from "../../core";
import {
  createMailCache,
  MailThreadUnavailableError,
  type MailWindowQuery,
} from "./engine";
import { bodyAnswers } from "./bodies";

// The reader's half of the cache: `thread(id)` from the stored body while it
// holds the thread's messages, the byte budget, prefetch — on a throwaway
// database over the fake provider.

const INBOX = roleMailboxId("inbox");
const ana = { name: "Ana", address: "ana@x.test" };

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb({ prefix: "mail_bodies" });
  await runMigrations(t.db);
});
afterAll(async () => {
  await t?.drop();
});
beforeEach(async () => {
  await t.db.execute(sql`delete from mail_accounts`);
});

function threads(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i + 1}`,
    messages: [
      {
        id: `m${i + 1}`,
        date: new Date(Date.UTC(2026, 0, 1, 10, i)).toISOString(),
        from: ana,
        subject: `s${i + 1}`,
        html: `<p>body ${i + 1}</p>`,
        unread: i % 2 === 0,
        attachments:
          i === 0
            ? [
                {
                  filename: "a.pdf",
                  mimeType: "application/pdf",
                  bytes: new Uint8Array([1, 2, 3]),
                },
              ]
            : [],
      },
    ],
  }));
}

function harness(
  n: number,
  deps: { bodyBudgetBytes?: number; perRun?: number } = {},
) {
  const f = createFakeMailProvider({ threads: threads(n) });
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
    ...(deps.bodyBudgetBytes === undefined
      ? {}
      : { bodyBudgetBytes: () => deps.bodyBudgetBytes! }),
    ...(deps.perRun === undefined
      ? {}
      : { prefetch: { perRun: () => deps.perRun! } }),
  });
  return {
    f,
    cache,
    background,
    count: (method: string) =>
      f.calls.filter((c) => c.method === method).length,
    resetCalls: () => f.calls.splice(0),
  };
}

const inbox: Filter = clause("mailboxes", "hasAny", [INBOX]) as Filter;
const win = (limit: number): MailWindowQuery => ({ limit, where: inbox });

async function reasonOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof MailThreadUnavailableError) return err.reason;
    throw err;
  }
  throw new Error("expected the thread to be unavailable");
}

async function storedBodies(): Promise<string[]> {
  const rows = await executeRows(t.db, {
    query: sql`select thread_id from mail_thread_bodies order by thread_id`,
    row: z.object({ thread_id: z.string() }),
  });
  return rows.map((r) => r.thread_id);
}

describe("mail cache: thread content", () => {
  test("fetched once, then answered from the store; a flag change re-fetches nothing", async () => {
    const h = harness(3);
    const first = await h.cache.thread("t3");
    expect(first.content.messages.map((m) => m.html?.content)).toEqual([
      "<p>body 3</p>",
    ]);
    expect(first.content.messages[0]!.unread).toBe(true);
    expect(h.count("getThreadContent")).toBe(1);
    await h.cache.settled();

    await h.f.provider.setFlags(h.f.targets([threadId("t3")]), {
      unread: false,
    });
    await h.cache.catchUp();
    h.resetCalls();
    const again = await h.cache.thread("t3");
    expect(h.count("getThreadContent")).toBe(0);
    // The summary's facts over the stored content.
    expect(again.content.messages[0]!.unread).toBe(false);
  });

  test("a reply makes the stored body stale: fetched again with the new message", async () => {
    const h = harness(2);
    await h.cache.thread("t2");
    await h.cache.settled();
    h.f.deliver("t2", {
      id: "m2b",
      date: "2026-01-02T09:00:00Z",
      from: ana,
      subject: "re",
      text: "reply",
    });
    await h.cache.catchUp();
    h.resetCalls();
    const read = await h.cache.thread("t2");
    expect(read.content.messages.map((m) => String(m.id))).toEqual([
      "m2",
      "m2b",
    ]);
    expect(h.count("getThreadContent")).toBe(1);
  });

  test("a thread never listed is read by id; an unknown one is gone", async () => {
    const h = harness(2);
    expect((await h.cache.thread("t1")).summary.subject).toBe("s1");
    expect(await reasonOf(h.cache.thread("nope"))).toBe("gone");
  });

  test("offline: a stored body still answers, one not stored is offline-not-cached", async () => {
    const h = harness(2);
    await h.cache.thread("t1");
    await h.cache.settled();
    h.f.setConnected("unreachable");
    expect((await h.cache.thread("t1")).content.messages).toHaveLength(1);
    h.f.failNext(
      "getThreads",
      new MailUnreachableError("threads.get", new Error("ENETDOWN")),
    );
    expect(await reasonOf(h.cache.thread("t2"))).toBe("offline-not-cached");
  });

  test("not connected is its own reason", async () => {
    const h = harness(1);
    h.f.setConnected(false);
    expect(await reasonOf(h.cache.thread("t1"))).toBe("not-connected");
  });

  test("an attachment's bytes, by its message and part", async () => {
    const h = harness(1);
    const read = await h.cache.thread("t1");
    const a = read.content.messages[0]!.attachments[0]!;
    const got = await h.cache.attachment("t1", "m1", a.ref.partId);
    expect(got.meta.filename).toBe("a.pdf");
    expect([...got.bytes]).toEqual([1, 2, 3]);
    expect(await reasonOf(h.cache.attachment("t1", "m1", "99"))).toBe("gone");
  });

  test("past the byte budget the least recently opened bodies go first", async () => {
    // Each body weighs its text plus 512: three do not fit in 1,100 bytes.
    const h = harness(3, { bodyBudgetBytes: 1_100 });
    await h.cache.thread("t1");
    await h.cache.thread("t2");
    expect(await storedBodies()).toEqual(["t1", "t2"]);
    await h.cache.thread("t3");
    expect(await storedBodies()).toEqual(["t2", "t3"]);
    // Evicted: fetched again on its next open.
    h.resetCalls();
    await h.cache.thread("t1");
    expect(h.count("getThreadContent")).toBe(1);
  });
});

describe("mail cache: prefetch", () => {
  test("a window read prefetches the Inbox's unread and the view's head, in the background", async () => {
    const h = harness(6, { perRun: 25 });
    await h.cache.window(win(6));
    await h.cache.prefetchSettled();
    expect(await storedBodies()).toEqual(["t1", "t2", "t3", "t4", "t5", "t6"]);
    expect(
      h.f.calls
        .filter((c) => c.method === "getThreadContent")
        .every((c) => c.priority === "background"),
    ).toBe(true);
    // Opening a prefetched thread asks the provider for nothing.
    h.resetCalls();
    await h.cache.thread("t4");
    expect(h.count("getThreadContent")).toBe(0);
    expect(h.background).toEqual([]);
  });

  test("at most perRun bodies a run, the open thread's neighbours first", async () => {
    const h = harness(10, { perRun: 2 });
    await h.cache.window(win(10));
    await h.cache.prefetchSettled();
    await t.db.execute(sql`delete from mail_thread_bodies`);
    await h.cache.thread("t5");
    await h.cache.prefetchSettled();
    expect(await storedBodies()).toEqual(["t4", "t5", "t6"]);
  });
});

describe("bodies (pure)", () => {
  test("a body answers a summary holding exactly its messages, in order", () => {
    const summary = {
      messages: [{ id: "a" }, { id: "b" }],
    } as unknown as Parameters<typeof bodyAnswers>[1];
    expect(bodyAnswers(["a", "b"], summary)).toBe(true);
    expect(bodyAnswers(["a"], summary)).toBe(false);
    expect(bodyAnswers(["b", "a"], summary)).toBe(false);
  });
});
