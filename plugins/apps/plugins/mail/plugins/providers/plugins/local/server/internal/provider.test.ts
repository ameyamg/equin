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
import {
  and,
  clause,
  or,
  type Filter,
} from "@plugins/network/plugins/live/plugins/filter/core";
import { buildMimeMessage } from "@plugins/packages/plugins/mime/core";
import {
  changeCursor,
  MAIL_QUERY_OPS,
  MailRefusedError,
  messageId,
  roleMailboxId,
  threadId,
  type MailboxId,
  type MailProvider,
  type MailQuery,
  type Participant,
} from "@plugins/apps/plugins/mail/plugins/provider/core";
import {
  createFakeMailProvider,
  type FakeMessageInput,
} from "@plugins/apps/plugins/mail/plugins/provider/server/testing";
import { createLocalMail, LOCAL_ACCOUNT_ID, type LocalMail } from "./provider";

const INBOX = roleMailboxId("inbox");
const SENT = roleMailboxId("sent");
const TRASH = roleMailboxId("trash");
const DRAFTS = roleMailboxId("drafts");
const ana: Participant = { name: "Ana", address: "ana@x.test" };
const bo: Participant = { name: null, address: "bo@x.test" };
const me: Participant = { name: "Me", address: "me@x.test" };

let t: TestDb;
let local: LocalMail;
let p: MailProvider;
beforeAll(async () => {
  t = await createTestDb({ prefix: "mail_local" });
  await runMigrations(t.db);
});
afterAll(async () => {
  await t?.drop();
});
beforeEach(async () => {
  for (const table of [
    "mail_local_attachments",
    "mail_local_messages",
    "mail_local_mailboxes",
    "mail_local_changes",
    "mail_local_accounts",
  ])
    await t.db.execute(sql`DELETE FROM ${sql.identifier(table)}`);
  local = createLocalMail({ db: t.db });
  p = local.definition.open(LOCAL_ACCOUNT_ID);
  await local.setAccount({
    address: me.address,
    displayName: "Me",
    signature: "— me",
  });
});

/** One message of the shared corpus: what both the fake and the local mailbox hold. */
type Seed = { thread: string } & Required<
  Pick<
    FakeMessageInput,
    "id" | "from" | "to" | "subject" | "mailboxes" | "unread" | "starred"
  >
> & { date: string; text: string; attachments: number };

const CORPUS: Seed[] = [
  {
    thread: "t1",
    id: "m1",
    date: "2026-11-01T10:00:00.000Z",
    from: ana,
    to: [me],
    subject: "Lisbon flights",
    text: "the 9:40 to Lisbon",
    mailboxes: [INBOX],
    unread: true,
    starred: false,
    attachments: 1,
  },
  {
    thread: "t1",
    id: "m2",
    date: "2026-11-01T11:00:00.000Z",
    from: me,
    to: [ana, bo],
    subject: "Re: Lisbon flights",
    text: "booked!",
    mailboxes: [SENT],
    unread: false,
    starred: true,
    attachments: 0,
  },
  {
    thread: "t2",
    id: "m3",
    date: "2026-11-02T09:30:00.500Z",
    from: bo,
    to: [me],
    subject: "Piano lesson",
    text: "Thursday instead?",
    mailboxes: [INBOX],
    unread: false,
    starred: false,
    attachments: 0,
  },
  {
    thread: "t3",
    id: "m4",
    date: "2026-11-03T08:00:00.000Z",
    from: { name: "Shop", address: "receipts@shop.test" },
    to: [me],
    subject: "Your receipt",
    text: "€12.00",
    mailboxes: [],
    unread: false,
    starred: false,
    attachments: 2,
  },
  {
    thread: "t4",
    id: "m5",
    date: "2026-11-04T08:00:00.000Z",
    from: { name: "Spam", address: "win@spam.test" },
    to: [],
    subject: "You won",
    text: "click",
    mailboxes: [roleMailboxId("spam")],
    unread: true,
    starred: false,
    attachments: 0,
  },
  {
    thread: "t5",
    id: "m6",
    date: "2026-11-05T08:00:00.000Z",
    from: ana,
    to: [me],
    subject: "Old note",
    text: "bin it",
    mailboxes: [TRASH],
    unread: false,
    starred: true,
    attachments: 0,
  },
];

const bytes = new TextEncoder().encode("PDF");

async function seedBoth() {
  const fake = createFakeMailProvider({
    account: { accountId: LOCAL_ACCOUNT_ID, address: me.address },
  });
  for (const m of CORPUS) {
    const files = Array.from({ length: m.attachments }, (_, i) => ({
      filename: `f${i}.pdf`,
      mimeType: "application/pdf",
      bytes,
    }));
    fake.deliver(m.thread, { ...m, attachments: files });
    await local.deliver({
      threadId: m.thread,
      ...m,
      date: new Date(m.date),
      rfc822MessageId: `<${m.id}@x.test>`,
      attachments: files,
    });
  }
  return fake;
}

/** Every page of a query's list, as `thread/message` keys. */
async function list(provider: MailProvider, providerQuery: string, limit = 2) {
  const out: string[] = [];
  let cursor = null;
  for (;;) {
    const page = await provider.listMessages(providerQuery as never, {
      olderThan: null,
      limit,
      cursor,
    });
    out.push(...page.hits.map((h) => `${h.thread}/${h.message}`));
    if (page.next === null) return out;
    cursor = page.next;
  }
}

/** A sample operand for each pair of the contract. */
function operands(column: string, op: string): unknown[] {
  switch (column) {
    case "mailboxes":
      return [[INBOX], [INBOX, SENT], [TRASH]];
    case "unread":
    case "starred":
    case "hasAttachment":
      return [true, false];
    case "date":
      return ["2026-11-02T09:30:00.500Z", "2026-11-03T08:00:00.000Z"];
    default:
      return op === "notContains"
        ? ["lisbon", "Ana <"]
        : ["lisbon", "ANA", "bo@x", "€12", "click"];
  }
}

describe("the local provider", () => {
  test("every MAIL_QUERY_OPS pair compiles and lists what the in-memory fake lists", async () => {
    const fake = await seedBoth();
    const mailboxes = await p.listMailboxes();
    for (const [column, ops] of Object.entries(MAIL_QUERY_OPS)) {
      for (const op of ops) {
        for (const operand of operands(column, op)) {
          const q = clause(
            column as never,
            op as never,
            operand as never,
          ) as MailQuery;
          const compiled = local.definition.compileQuery(q, { mailboxes });
          expect([column, op, compiled.kind]).toEqual([column, op, "query"]);
          if (compiled.kind !== "query") continue;
          const want = await list(fake.provider, compiled.providerQuery);
          const got = await list(p, compiled.providerQuery);
          expect([column, op, operand, got]).toEqual([
            column,
            op,
            operand,
            want,
          ]);
        }
      }
    }
    // Trees, and the empty query.
    for (const q of [
      undefined,
      and(clause("unread", "eq", true), clause("from", "contains", "ana")),
      or(
        clause("mailboxes", "hasAny", [SENT]),
        clause("hasAttachment", "eq", true),
      ),
    ] as MailQuery[]) {
      const compiled = local.definition.compileQuery(q, { mailboxes });
      if (compiled.kind !== "query") throw new Error("not compiled");
      expect(await list(p, compiled.providerQuery)).toEqual(
        await list(fake.provider, compiled.providerQuery),
      );
    }
  });

  test("a mailbox the account lacks is refused, never dropped", async () => {
    const mailboxes = await p.listMailboxes();
    const compiled = local.definition.compileQuery(
      clause("mailboxes", "hasAny", ["nope"]) as Filter as MailQuery,
      { mailboxes },
    );
    expect(compiled).toMatchObject({
      kind: "refused",
      refusal: { reason: "unknown-mailbox" },
    });
  });

  test("summaries, content and attachments are the fake's", async () => {
    const fake = await seedBoth();
    const ids = ["t1", "t2", "t3", "gone"].map(threadId);
    const mine = await p.getThreads(ids);
    const theirs = await fake.provider.getThreads(ids);
    const strip = (r: (typeof mine)[number]) =>
      r.kind === "found"
        ? { ...r, summary: { ...r.summary, version: null } }
        : r;
    expect(mine.map(strip)).toEqual(theirs.map(strip));
    const content = await p.getThreadContent(threadId("t3"));
    if (content.kind !== "found") throw new Error("gone");
    const [msg] = content.content.messages;
    expect(msg!.attachments.map((a) => [a.filename, a.size])).toEqual([
      ["f0.pdf", 3],
      ["f1.pdf", 3],
    ]);
    expect(await p.getAttachment(msg!.attachments[1]!.ref)).toEqual(bytes);
    const boxes = await p.listMailboxes();
    expect(boxes.find((b) => b.id === INBOX)!.counts).toEqual({
      threads: 2,
      unread: 1,
    });
  });

  test("writes are target-state, logged, versioned and pushed", async () => {
    await seedBoth();
    let signals = 0;
    local.definition.push!.listen({
      changed: () => signals++,
      state: () => {},
    });
    const cursor = await p.currentCursor();
    const [before] = await p.getThreads([threadId("t1")]);
    const target = { thread: threadId("t1"), messages: [messageId("m1")] };
    await p.archive([target]);
    await p.archive([target]); // a replay is harmless
    await p.setFlags([target], { unread: false, starred: true });
    const [after] = await p.getThreads([threadId("t1")]);
    if (before?.kind !== "found" || after?.kind !== "found") throw new Error();
    expect(after.summary.version).not.toBe(before.summary.version);
    expect(after.summary.messages[0]).toMatchObject({
      mailboxes: [],
      unread: false,
      starred: true,
    });
    expect(signals).toBe(3);
    const changes = await p.changesSince(cursor);
    expect(changes).toMatchObject({
      kind: "changes",
      threads: ["t1"],
      mailboxes: "changed",
      more: false,
    });
    await p.trash([target]);
    await p.moveToInbox([target]);
    const [back] = await p.getThreads([threadId("t1")]);
    if (back?.kind !== "found") throw new Error();
    expect(back.summary.messages[0]!.mailboxes).toEqual([INBOX]);
    expect(await p.changesSince(changeCursor("999999"))).toEqual({
      kind: "reset",
    });
  });

  test("labels: create, rename, move (never under itself), colour from the palette, delete moves children up", async () => {
    await seedBoth();
    const travel = await p.createMailbox({ name: "Travel", parentId: null });
    const lisbon = await p.createMailbox({
      name: "Lisbon",
      parentId: travel.id,
    });
    expect(
      p.createMailbox({ name: "Lisbon", parentId: travel.id }),
    ).rejects.toThrow(MailRefusedError);
    await p.setMailboxes(
      [{ thread: threadId("t1"), messages: [messageId("m1")] }],
      { add: [lisbon.id], remove: [] },
    );
    expect(p.moveMailbox(travel.id, lisbon.id)).rejects.toThrow(
      MailRefusedError,
    );
    await p.renameMailbox(lisbon.id, "Lisboa");
    await p.setMailboxColor(lisbon.id, {
      background: "#ffad47",
      text: "#ffffff",
    });
    expect(
      p.setMailboxColor(lisbon.id, { background: "#123456", text: "#ffffff" }),
    ).rejects.toThrow(MailRefusedError);
    let boxes = await p.listMailboxes();
    expect(boxes.find((b) => b.id === lisbon.id)).toMatchObject({
      name: "Lisboa",
      parentId: travel.id,
      color: { background: "#ffad47" },
      counts: { threads: 1, unread: 1 },
    });
    await p.deleteMailbox(travel.id);
    boxes = await p.listMailboxes();
    expect(boxes.find((b) => b.id === lisbon.id)!.parentId).toBeNull();
    await p.deleteMailbox(lisbon.id);
    const [t1] = await p.getThreads([threadId("t1")]);
    if (t1?.kind !== "found") throw new Error();
    expect(t1.summary.mailboxes).not.toContain(lisbon.id as MailboxId);
  });

  test("deleting a label refuses to put two sub-labels of one name side by side; a deleted label is never written", async () => {
    await seedBoth();
    const a = await p.createMailbox({ name: "A", parentId: null });
    await p.createMailbox({ name: "B", parentId: a.id });
    await p.createMailbox({ name: "B", parentId: null });
    expect(p.deleteMailbox(a.id)).rejects.toThrow(MailRefusedError);
    expect((await p.listMailboxes()).some((b) => b.id === a.id)).toBe(true);
    const gone = await p.createMailbox({ name: "Gone", parentId: null });
    await p.deleteMailbox(gone.id);
    expect(
      p.setMailboxes(
        [{ thread: threadId("t1"), messages: [messageId("m1")] }],
        { add: [gone.id], remove: [] },
      ),
    ).rejects.toThrow(MailRefusedError);
  });

  test("concurrent writes commit in change-log order: every one is seen past a cursor", async () => {
    await seedBoth();
    const cursor = await p.currentCursor();
    const targets = CORPUS.map((c) => ({
      thread: threadId(c.thread),
      messages: [messageId(c.id)],
    }));
    await Promise.all(targets.map((t) => p.setFlags([t], { starred: true })));
    const changes = await p.changesSince(cursor);
    if (changes.kind !== "changes") throw new Error("reset");
    expect([...changes.threads].sort()).toEqual(
      [...new Set(CORPUS.map((c) => c.thread))].sort().map(threadId),
    );
  });

  test("a sent message keeps its Reply-To, a body's unknown charset and which parts are inline", async () => {
    const mime = new TextEncoder().encode(
      [
        "From: me@x.test",
        "To: bo@x.test",
        "Reply-To: Other <other@x.test>",
        "Subject: hi",
        "Message-ID: <rt@x.test>",
        'Content-Type: multipart/mixed; boundary="b"',
        "",
        "--b",
        'Content-Type: text/plain; charset="x-nope"',
        "",
        "body",
        "--b",
        "Content-Type: image/png",
        "Content-ID: <pic>",
        'Content-Disposition: attachment; filename="pic.png"',
        "Content-Transfer-Encoding: base64",
        "",
        "AAEC",
        "--b",
        "Content-Type: image/png",
        "Content-ID: <logo>",
        "Content-Transfer-Encoding: base64",
        "",
        "AAEC",
        "--b--",
      ].join("\r\n"),
    );
    const sent = await p.send({
      mime,
      threadId: null,
      rfc822MessageId: "<rt@x.test>",
    });
    const content = await p.getThreadContent(sent.threadId);
    if (content.kind !== "found") throw new Error();
    const [msg] = content.content.messages;
    expect(msg!.replyTo).toEqual([{ name: "Other", address: "other@x.test" }]);
    expect(msg!.text).toEqual({ content: "body", unknownCharset: "x-nope" });
    expect(msg!.attachments.map((x) => [x.contentId, x.inline])).toEqual([
      ["pic", false],
      ["logo", true],
    ]);
  });

  test("send parses the bytes, stores in Sent, threads by In-Reply-To; to self also lands in the Inbox", async () => {
    await seedBoth();
    const reply = buildMimeMessage({
      from: me,
      to: [ana],
      subject: "Re: Lisbon flights",
      date: new Date(),
      messageId: "<r1@x.test>",
      inReplyTo: "<m1@x.test>",
      references: ["<m1@x.test>"],
      bcc: [bo],
      text: "see you there",
      attachments: [{ filename: "plan.txt", mimeType: "text/plain", bytes }],
    });
    const sent = await p.send({
      mime: reply,
      threadId: null,
      rfc822MessageId: "<r1@x.test>",
    });
    expect(sent.threadId).toBe(threadId("t1"));
    // A replay answers the message it stored.
    expect(
      await p.send({
        mime: reply,
        threadId: null,
        rfc822MessageId: "<r1@x.test>",
      }),
    ).toEqual(sent);
    const content = await p.getThreadContent(threadId("t1"));
    if (content.kind !== "found") throw new Error();
    const last = content.content.messages.at(-1)!;
    expect(last).toMatchObject({
      id: sent.messageId,
      mailboxes: [SENT],
      to: [ana],
      bcc: [bo],
      inReplyTo: "<m1@x.test>",
      text: { content: "see you there" },
    });
    expect(last.attachments.map((a) => a.filename)).toEqual(["plan.txt"]);
    const self = buildMimeMessage({
      from: me,
      to: [me],
      subject: "note to self",
      date: new Date(),
      messageId: "<s1@x.test>",
      text: "milk",
    });
    const note = await p.send({
      mime: self,
      threadId: null,
      rfc822MessageId: "<s1@x.test>",
    });
    const [summary] = await p.getThreads([note.threadId]);
    if (summary?.kind !== "found") throw new Error();
    expect(summary.summary.mailboxes).toEqual([INBOX, SENT]);
    expect(await p.findMessage("<s1@x.test>")).toEqual({
      kind: "found",
      ...note,
    });
    expect(await p.sendIdentity(me.address)).toEqual({
      address: me.address,
      displayName: "Me",
      signature: { text: "— me" },
    });
  });

  test("drafts: save, replace (the draft id stays), find, delete (twice is harmless)", async () => {
    const draft = (text: string) =>
      buildMimeMessage({
        from: me,
        to: [bo],
        subject: "Lesson",
        date: new Date(),
        messageId: `<d-${text}@x.test>`,
        text,
      });
    const first = await p.saveDraft(
      { mime: draft("a"), threadId: null, rfc822MessageId: "<d-a@x.test>" },
      null,
    );
    const second = await p.saveDraft(
      { mime: draft("b"), threadId: null, rfc822MessageId: "<d-b@x.test>" },
      first.draftId,
    );
    expect(second.draftId).toBe(first.draftId);
    expect(second.threadId).toBe(first.threadId);
    const content = await p.getThreadContent(first.threadId);
    if (content.kind !== "found") throw new Error();
    expect(
      content.content.messages.map((m) => [
        m.isDraft,
        m.mailboxes,
        m.text?.content,
      ]),
    ).toEqual([[true, [DRAFTS], "b"]]);
    expect(await p.findDraft(second.messageId)).toEqual({
      kind: "found",
      draftId: first.draftId,
    });
    await p.deleteDraft(first.draftId);
    await p.deleteDraft(first.draftId);
    expect(await p.getThreadContent(first.threadId)).toEqual({ kind: "gone" });
  });

  test("no account: not connected, with the connect surface's sentence", async () => {
    await t.db.execute(sql`DELETE FROM mail_local_accounts`);
    expect(await local.definition.connectedAccount()).toEqual({
      kind: "not-connected",
      message: "No local mailbox on this device.",
    });
  });
});
