import { describe, expect, test } from "bun:test";
import { and, clause } from "@plugins/network/plugins/live/plugins/filter/core";
import {
  nativeMailboxId,
  roleMailboxId,
  threadId,
  type MailQuery,
} from "../../core";
import type { ProviderQuery } from "../../core/internal/ids";
import { createFakeMailProvider } from "./fake-provider";

const ana = { name: "Ana", address: "ana@x.test" };
const bo = { name: null, address: "bo@x.test" };
const INBOX = roleMailboxId("inbox");

function fixture() {
  return createFakeMailProvider({
    threads: [
      {
        id: "t1",
        messages: [
          {
            date: "2026-01-01T10:00:00Z",
            from: ana,
            subject: "Plan",
            unread: false,
          },
          {
            date: "2026-01-03T10:00:00Z",
            from: bo,
            subject: "Re: Plan",
            unread: true,
          },
        ],
      },
      {
        id: "t2",
        messages: [
          {
            date: "2026-01-02T10:00:00Z",
            from: ana,
            subject: "Lunch",
            unread: true,
          },
        ],
      },
    ],
  });
}

function compiled(f: ReturnType<typeof fixture>, q: MailQuery): ProviderQuery {
  const c = f.definition.compileQuery(q, { mailboxes: [] });
  if (c.kind !== "query") throw new Error(`not compiled: ${JSON.stringify(c)}`);
  return c.providerQuery;
}

const page = { olderThan: null, limit: 10, cursor: null };

describe("fake mail provider", () => {
  test("a query matches per message: unread AND from ana needs one message that is both", async () => {
    const f = fixture();
    const q = compiled(
      f,
      and(clause("unread", "eq", true), clause("from", "contains", "ana")),
    );
    const r = await f.provider.listThreads(q, page);
    // t1 has an unread message (bo's) and a message from ana, but not one message that is both.
    expect(r.refs.map((x) => x.id)).toEqual([threadId("t2")]);
  });

  test("newest first, paged by cursor, cut per message", async () => {
    const f = fixture();
    const all = compiled(f, undefined);
    const first = await f.provider.listThreads(all, { ...page, limit: 1 });
    expect(first.refs.map((x) => x.id)).toEqual([threadId("t1")]);
    const second = await f.provider.listThreads(all, {
      ...page,
      limit: 1,
      cursor: first.next,
    });
    expect(second.refs.map((x) => x.id)).toEqual([threadId("t2")]);
    expect(second.next).toBeNull();
    // Before Jan 2 10:00:00 (its second included): t1's Jan 1 message and t2's own.
    const cut = await f.provider.listThreads(all, {
      ...page,
      olderThan: new Date("2026-01-02T10:00:00Z"),
    });
    expect(cut.refs.map((x) => x.id).sort()).toEqual([
      threadId("t1"),
      threadId("t2"),
    ]);
  });

  test("an unknown mailbox and an undeclared operator are refused, or: [] is nothing", () => {
    const f = fixture();
    const ctx = { mailboxes: [] };
    expect(
      f.definition.compileQuery(
        clause("mailboxes", "hasAny", [nativeMailboxId("nope")]),
        ctx,
      ).kind,
    ).toBe("refused");
    const isEmpty = f.definition.compileQuery(
      clause("subject", "isEmpty") as unknown as MailQuery,
      ctx,
    );
    expect(isEmpty.kind === "refused" && isEmpty.refusal.reason).toBe(
      "unsupported-op",
    );
    expect(f.definition.compileQuery({ or: [] }, ctx).kind).toBe("nothing");
  });

  test("summaries are unions over messages; versions move on change; changes and reset", async () => {
    const f = fixture();
    const [s] = await f.provider.getThreads([threadId("t1")]);
    if (!s || s.kind !== "found") throw new Error("t1 not found");
    expect(s.summary.unread).toBe(true);
    expect(s.summary.participants.map((p) => p.address)).toEqual([
      "ana@x.test",
      "bo@x.test",
    ]);
    // Per-message facts: bo's reply is the unread one.
    expect(s.summary.messages.map((m) => m.unread)).toEqual([false, true]);
    const cursor = await f.provider.currentCursor();
    await f.provider.archive([threadId("t1")]);
    const changes = await f.provider.changesSince(cursor);
    expect(changes).toMatchObject({
      kind: "changes",
      threads: [threadId("t1")],
      more: false,
    });
    const [after] = await f.provider.getThreads([threadId("t1")]);
    if (!after || after.kind !== "found") throw new Error("t1 not found");
    expect(after.summary.mailboxes).not.toContain(INBOX);
    expect(after.summary.version).not.toBe(s.summary.version);
    f.expireHistory();
    expect(await f.provider.changesSince(cursor)).toEqual({ kind: "reset" });
  });

  test("a send whose answer was lost is found by its Message-ID", async () => {
    const f = fixture();
    const mime = new TextEncoder().encode(
      "Message-ID: <abc@me>\r\nSubject: Hi\r\nFrom: me@x.test\r\n\r\nhello",
    );
    f.failNext("send", f.outcomeUnknown("send"), { after: true });
    expect(
      f.provider.send({ mime, threadId: null, rfc822MessageId: "<abc@me>" }),
    ).rejects.toThrow("may or may not");
    await Promise.resolve();
    const found = await f.provider.findMessage("<abc@me>");
    expect(found.kind).toBe("found");
    expect(
      f.provider.send({ mime, threadId: null, rfc822MessageId: "<other@me>" }),
    ).rejects.toThrow("Message-ID");
  });
});
