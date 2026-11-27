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
  type FakeMailProvider,
} from "@plugins/apps/plugins/mail/plugins/provider/server/testing";
import {
  MailNotConnectedError,
  roleMailboxId,
} from "@plugins/apps/plugins/mail/plugins/provider/core";
import { mailThreads } from "../../core";
import { createMailCache } from "./engine";

// Which provider the account is on, when a composition registers several
// (2026-11-27: promo-film shipped the local demo mailbox beside Gmail, and
// every mail.account-status read failed "v1 serves one mail provider, 2 are
// registered"). Decided by Settings' choice or by what is connected, never by
// how many are registered.

const INBOX = roleMailboxId("inbox");
const inbox = clause("mailboxes", "hasAny", [INBOX]) as Filter;

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb({ prefix: "mail_providers" });
  await runMigrations(t.db);
});
afterAll(async () => {
  await t?.drop();
});
beforeEach(async () => {
  await t.db.execute(sql`delete from mail_accounts`);
});

function fake(id: string, address: string, subject: string): FakeMailProvider {
  return createFakeMailProvider({
    kind: { id, label: id.toUpperCase() },
    account: { accountId: `${id}-account`, address },
    threads: [
      {
        id: `${id}-t1`,
        messages: [
          {
            id: `${id}-m1`,
            date: "2026-01-01T10:00:00.000Z",
            from: { name: "Ana", address: "ana@x.test" },
            subject,
          },
        ],
      },
    ],
  });
}

function harness(fakes: FakeMailProvider[]) {
  let chosen: string | null = null;
  const cache = createMailCache({
    db: t.db,
    providers: () => ({ all: fakes.map((f) => f.definition), chosen }),
    refuse: (code, message) => mailThreads.refuse(code, message),
    notifyThreads: () => {},
    notifyMailboxes: () => {},
    notifyStatus: () => {},
    changeSignal: () => ({
      push: { kind: "none" },
      everyMs: 30_000,
      idleEveryMs: null,
      watching: false,
      ticking: false,
    }),
    onBackgroundError: (_what, err) => {
      throw err;
    },
    enqueueOp: async () => {},
  });
  return {
    cache,
    choose: (id: string | null) => {
      chosen = id;
    },
    subjects: async () =>
      (await cache.window({ limit: 5, where: inbox })).map((r) => r.subject),
  };
}

async function refusal(
  p: Promise<unknown>,
): Promise<{ code: string; message: string }> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ResourceRefusal)
      return { code: err.code, message: err.message };
    throw err;
  }
  throw new Error("expected a refusal");
}

describe("mail cache: the account's provider", () => {
  test("two registered, one connected: that one serves the account", async () => {
    const a = fake("a", "a@x.test", "from a");
    const b = fake("b", "b@x.test", "from b");
    a.setConnected(false);
    const h = harness([a, b]);
    expect(await h.subjects()).toEqual(["from b"]);
    expect(h.cache.currentProvider()?.id).toBe("b");
    expect(await h.cache.status()).toMatchObject({
      kind: "account",
      address: "b@x.test",
    });
    await h.cache.settled();
  });

  test("an offline one counts as the account's (its cached mail still answers)", async () => {
    const a = fake("a", "a@x.test", "from a");
    const b = fake("b", "b@x.test", "from b");
    a.setConnected(false);
    b.setConnected("unreachable");
    const h = harness([a, b]);
    expect((await refusal(h.subjects())).code).toBe("offline-not-cached");
  });

  test("none connected: refused not-connected with each provider's sentence; the status is none, never a failure", async () => {
    const a = fake("a", "a@x.test", "from a");
    const b = fake("b", "b@x.test", "from b");
    a.setConnected(false);
    b.setConnected(false);
    const h = harness([a, b]);
    const r = await refusal(h.subjects());
    expect(r.code).toBe("not-connected");
    expect(r.message).toContain("A:");
    expect(r.message).toContain("B:");
    expect(await h.cache.status()).toEqual({ kind: "none" });
  });

  test("several connected: refused provider-not-chosen until chosen, then the one the cache holds", async () => {
    const a = fake("a", "a@x.test", "from a");
    const b = fake("b", "b@x.test", "from b");
    const h = harness([a, b]);
    const r = await refusal(h.subjects());
    expect(r.code).toBe("provider-not-chosen");
    expect(r.message).toContain("A, B");
    h.choose("a");
    expect(await h.subjects()).toEqual(["from a"]);
    await h.cache.settled();
    // Back to automatic: the account Mail was on stays the one served.
    h.choose(null);
    expect(await h.subjects()).toEqual(["from a"]);
    expect(await h.cache.status()).toMatchObject({
      kind: "account",
      address: "a@x.test",
    });
    await h.cache.settled();
  });

  test("the chosen provider decides, even when another is the connected one", async () => {
    const a = fake("a", "a@x.test", "from a");
    const b = fake("b", "b@x.test", "from b");
    a.setConnected(false);
    const h = harness([a, b]);
    expect(await h.subjects()).toEqual(["from b"]);
    await h.cache.settled();
    h.choose("a");
    expect((await refusal(h.subjects())).code).toBe("not-connected");
    // The status is the chosen provider's account: none held yet.
    expect(await h.cache.status()).toEqual({ kind: "none" });
  });

  test("moving to another provider drops the other account's cache: status, preload and sender name one account", async () => {
    const a = fake("a", "a@x.test", "from a");
    const b = fake("b", "b@x.test", "from b");
    const h = harness([a, b]);
    h.choose("b");
    expect(await h.subjects()).toEqual(["from b"]);
    await h.cache.settled();
    expect((await h.cache.sender(null)).accountId).toBe("b-account");
    h.choose("a");
    expect(await h.subjects()).toEqual(["from a"]);
    await h.cache.settled();
    const rows = await t.db.execute(sql`select id from mail_accounts`);
    expect(rows.rows.map((r) => (r as { id: string }).id)).toEqual([
      "a-account",
    ]);
    expect(await h.cache.status()).toMatchObject({
      kind: "account",
      address: "a@x.test",
    });
    // Back to automatic, both connected: the account the cache holds stays.
    h.choose(null);
    expect(await h.subjects()).toEqual(["from a"]);
    // A draft written from the account Mail left is never sent through this one.
    let refused: unknown;
    try {
      await h.cache.sender("b-account");
    } catch (err) {
      refused = err;
    }
    expect(refused).toBeInstanceOf(MailNotConnectedError);
    expect((await h.cache.sender("a-account")).address).toBe("a@x.test");
    await h.cache.settled();
  });

  test("a chosen provider this app does not register is refused, naming it", async () => {
    const h = harness([fake("a", "a@x.test", "from a")]);
    h.choose("gone");
    const r = await refusal(h.subjects());
    expect(r.code).toBe("not-connected");
    expect(r.message).toContain('"gone"');
    expect(await h.cache.status()).toEqual({ kind: "none" });
  });

  test("no provider registered: refused, and the status is none", async () => {
    const h = harness([]);
    expect((await refusal(h.subjects())).code).toBe("not-connected");
    expect(await h.cache.status()).toEqual({ kind: "none" });
  });
});
