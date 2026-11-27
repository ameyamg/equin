import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { eq, sql } from "drizzle-orm";
import {
  createTestDb,
  type TestDb,
} from "@plugins/database/plugins/db-test-fixture/server/testing";
import { runMigrations } from "@plugins/database/plugins/migrations/server/testing";
import { HttpError } from "@plugins/infra/plugins/endpoints/server";
import {
  createFakeMailProvider,
  type FakeMailProviderOptions,
} from "@plugins/apps/plugins/mail/plugins/provider/server/testing";
import {
  MailUnreachableError,
  roleMailboxId,
  providerQuery,
  threadId,
} from "@plugins/apps/plugins/mail/plugins/provider/core";
import {
  DraftContentSchema,
  isDraftEmpty,
  mailDraftIdKind,
  type DraftContent,
} from "../../core";
import {
  createDateFormatter,
  DEFAULT_DATE_FORMAT_PREFS,
} from "@plugins/fields/plugins/date/plugins/format/core/testing";
import { createOutbox, SendPendingError } from "./outbox";
import { _mailDrafts } from "./tables";

// The outbox on a throwaway database over the fake provider: drafts mirrored
// (created once, replaced after, deleted on discard), the undo-send window,
// and a send that is never made twice.

const INBOX = roleMailboxId("inbox");
const DRAFTS = roleMailboxId("drafts");
const ana = { name: "Ana", address: "ana@x.test" };

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb({ prefix: "mail_compose" });
  await runMigrations(t.db);
});
afterAll(async () => {
  await t?.drop();
});
beforeEach(async () => {
  await t.db.execute(sql`delete from mail_drafts`);
});

function harness(o: Pick<FakeMailProviderOptions, "identity"> = {}) {
  const f = createFakeMailProvider({
    ...o,
    account: { accountId: "acct", address: "me@x.test" },
    threads: [
      {
        id: "t1",
        messages: [
          {
            id: "m1",
            date: "2026-11-25T09:00:00Z",
            from: ana,
            to: [{ name: null, address: "me@x.test" }],
            subject: "Lease",
            text: "Signed copy attached.",
            mailboxes: [INBOX],
            rfc822MessageId: "<m1@x.test>",
          },
        ],
      },
    ],
  });
  let clock = new Date("2026-11-26T12:00:00Z");
  const mirrors: string[] = [];
  const sends: { id: string; at: Date }[] = [];
  const files = new Map<string, Uint8Array>();
  /** Every message handed to the provider (drafts saved, sends), as its bytes. */
  const written: { method: "saveDraft" | "send"; mime: string }[] = [];
  const provider: typeof f.provider = {
    ...f.provider,
    saveDraft: (m, existing, o) => {
      written.push({ method: "saveDraft", mime: decodeMime(m.mime) });
      return f.provider.saveDraft(m, existing, o);
    },
    send: (m, o) => {
      written.push({ method: "send", mime: decodeMime(m.mime) });
      return f.provider.send(m, o);
    },
  };
  const outbox = createOutbox({
    db: t.db,
    dateFormatter: () => createDateFormatter(DEFAULT_DATE_FORMAT_PREFS),
    sender: async () => ({
      accountId: "acct",
      address: "me@x.test",
      provider,
    }),
    thread: async (id) => {
      const c = await f.provider.getThreadContent(threadId(id));
      if (c.kind !== "found") throw new Error(`no thread ${id}`);
      return { content: c.content };
    },
    forwardedFileId: async (a) => `fw-${a.partId}`,
    forwardedFile: async (a) => ({
      attachmentId: `fw-${a.partId}`,
      bytes: new Uint8Array([9]),
    }),
    uploadBytes: async (id) => files.get(id)!,
    importFile: async (file) => {
      const id = crypto.randomUUID();
      files.set(id, file.bytes);
      return id;
    },
    linkFiles: async () => {},
    undoSendMs: () => 10_000,
    enqueueMirror: async (id) => {
      mirrors.push(id);
    },
    enqueueSend: async (id, at) => {
      sends.push({ id, at });
    },
    syncSoon: () => {},
    now: () => clock,
  });
  const count = (method: string) =>
    f.calls.filter((c) => c.method === method).length;
  const row = async (id: string) =>
    (
      await t.db
        .select()
        .from(_mailDrafts)
        .where(eq(_mailDrafts.id, mailDraftIdKind.key(id)))
    )[0] ?? null;
  const draftsAtProvider = async () => {
    const all = await f.provider.listMessages(providerQuery(""), {
      olderThan: null,
      limit: 100,
      cursor: null,
    });
    const summaries = await f.provider.getThreads([
      ...new Set(all.hits.map((h) => h.thread)),
    ]);
    return summaries.flatMap((s) =>
      s.kind === "found" ? s.summary.messages.filter((m) => m.isDraft) : [],
    );
  };
  return {
    f,
    outbox,
    written,
    mirrors,
    sends,
    files,
    count,
    row,
    draftsAtProvider,
    /** Runs the latest send job queued for `id`. */
    due: (id: string) =>
      outbox.sendDue(id, sends.findLast((x) => x.id === id)!.at.toISOString()),
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

/** A message's bytes as text, quoted-printable undone (enough to read a plain text message's header and body). */
function decodeMime(bytes: Uint8Array): string {
  return new TextDecoder()
    .decode(bytes)
    .replace(/=\r\n/g, "")
    .replace(/=([0-9A-F]{2})/g, (_, h: string) =>
      String.fromCharCode(parseInt(h, 16)),
    );
}

const content = (over: Partial<DraftContent> = {}): DraftContent => ({
  to: "Bob <bob@y.test>",
  cc: "",
  bcc: "",
  subject: "Hello",
  body: "Hi Bob",
  // Most cases here are about the envelope: a plain body, sent as text alone.
  bodyFormat: "text",
  attachments: [],
  signature: true,
  ...over,
});

const newId = () => mailDraftIdKind.mint();

describe("drafts", () => {
  test("a start is idempotent under its id", async () => {
    const h = harness();
    const id = newId();
    const a = await h.outbox.start(id, { kind: "new" });
    await h.outbox.save(id, content());
    const b = await h.outbox.start(id, { kind: "new" });
    expect(a.id).toBe(id);
    expect(b.content.subject).toBe("Hello");
  });

  test("saves are mirrored: created once, then replaced, never a second draft", async () => {
    const h = harness();
    const id = newId();
    await h.outbox.start(id, { kind: "new" });
    // Nothing written yet: nothing at the provider.
    await h.outbox.mirror(id);
    expect(h.count("saveDraft")).toBe(0);
    await h.outbox.save(id, content());
    await h.outbox.mirror(id);
    await h.outbox.save(id, content({ body: "Hi Bob, again" }));
    await h.outbox.mirror(id);
    // A mirror with no new revision does nothing.
    await h.outbox.mirror(id);
    expect(h.count("saveDraft")).toBe(2);
    expect(await h.draftsAtProvider()).toHaveLength(1);
    const r = await h.row(id);
    expect(r!.mirroredRevision).toBe(r!.revision);
    expect(r!.providerDraftId).not.toBeNull();
  });

  test("discard deletes the provider's draft and the row", async () => {
    const h = harness();
    const id = newId();
    await h.outbox.start(id, { kind: "new" });
    await h.outbox.save(id, content());
    await h.outbox.mirror(id);
    await h.outbox.discard(id);
    expect(await h.outbox.read(id)).toBeNull();
    await h.outbox.mirror(id);
    expect(await h.row(id)).toBeNull();
    expect(await h.draftsAtProvider()).toHaveLength(0);
  });

  test("a draft create whose answer was lost is found, never made twice; a discard deletes it", async () => {
    const h = harness();
    const id = newId();
    await h.outbox.start(id, { kind: "new" });
    await h.outbox.save(id, content());
    h.f.failNext("saveDraft", h.f.outcomeUnknown("draft create"), {
      after: true,
    });
    expect(h.outbox.mirror(id)).rejects.toThrow(/may or may not/);
    await Bun.sleep(0);
    expect((await h.row(id))!.draftCreateAttempt).toBe("unknown");
    await h.outbox.save(id, content({ body: "more" }));
    await h.outbox.mirror(id);
    expect(await h.draftsAtProvider()).toHaveLength(1);
    expect((await h.row(id))!.draftCreateAttempt).toBeNull();
    await h.outbox.discard(id);
    await h.outbox.mirror(id);
    expect(await h.draftsAtProvider()).toHaveLength(0);
  });

  test("continue adopts a draft made elsewhere, and finds it again", async () => {
    const h = harness();
    const made = await h.f.provider.saveDraft(
      {
        mime: new TextEncoder().encode(
          "From: me@x.test\r\nTo: carol@z.test\r\nSubject: Plan\r\nMessage-ID: <d1@x.test>\r\n\r\nDraft text",
        ),
        threadId: null,
        rfc822MessageId: "<d1@x.test>",
      },
      null,
    );
    const a = await h.outbox.start(newId(), {
      kind: "continue",
      threadId: made.threadId as string,
      messageId: made.messageId as string,
    });
    expect(a.content.subject).toBe("Plan");
    const b = await h.outbox.start(newId(), {
      kind: "continue",
      threadId: made.threadId as string,
      messageId: made.messageId as string,
    });
    expect(b.id).toBe(a.id);
    // Saving replaces the provider's draft rather than adding one.
    await h.outbox.save(a.id, { ...a.content, body: "Draft text, more" });
    await h.outbox.mirror(a.id);
    expect(await h.draftsAtProvider()).toHaveLength(1);
  });
});

describe("reply", () => {
  test("starts addressed, Re:, threaded, and sends in the thread", async () => {
    const h = harness();
    const id = newId();
    const d = await h.outbox.start(id, {
      kind: "reply",
      threadId: "t1",
      messageId: "m1",
    });
    expect(d.content.to).toBe("Ana <ana@x.test>");
    expect(d.content.subject).toBe("Re: Lease");
    expect(d.replyingTo?.name).toBe("Ana");
    const r = await h.row(id);
    expect(r!.inReplyTo).toBe("<m1@x.test>");
    expect(r!.references).toEqual(["<m1@x.test>"]);
    await h.outbox.send(id, { ...d.content, body: "Thanks!" });
    h.advance(10_000);
    await h.due(id);
    const sent = h.f.calls.filter((c) => c.method === "send");
    expect(sent).toHaveLength(1);
    const thread = await h.f.provider.getThreadContent(
      (await h.row(id))!.sentThreadId as never,
    );
    expect(thread.kind).toBe("found");
    expect((await h.row(id))!.sentThreadId).toBe("t1");
  });
});

describe("the send-as identity", () => {
  test("drafts and sends go out under its display name, signed, the signature above the quote", async () => {
    const h = harness({
      identity: {
        displayName: "Mia Moreau",
        signature: { html: "<div><b>Mia</b><br>Paris &amp; Lyon</div>" },
      },
    });
    const id = newId();
    const d = await h.outbox.start(id, {
      kind: "reply",
      threadId: "t1",
      messageId: "m1",
    });
    // The editor holds only what the person writes: an untouched reply is empty.
    expect(d.content.body).toBe("");
    await h.outbox.save(id, { ...d.content, body: "Thanks!" });
    await h.outbox.mirror(id);
    await h.outbox.send(id, { ...d.content, body: "Thanks!" });
    h.advance(10_000);
    await h.due(id);
    expect(h.written.map((w) => w.method)).toEqual(["saveDraft", "send"]);
    for (const { mime } of h.written) {
      expect(mime).toMatch(/^From: "?Mia Moreau"? <me@x\.test>\r$/m);
      expect(mime).toContain(
        "Thanks!\r\n\r\n-- \r\nMia\r\nParis & Lyon\r\n\r\nOn ",
      );
    }
  });

  test("a name or signature changed at the provider applies to the next message; none set: the bare address, unsigned", async () => {
    const h = harness();
    const id = newId();
    await h.outbox.start(id, { kind: "new" });
    await h.outbox.save(id, content());
    await h.outbox.mirror(id);
    expect(h.written[0]!.mime).toMatch(/^From: me@x\.test\r$/m);
    expect(h.written[0]!.mime).not.toContain("-- ");
    h.f.setIdentity({ displayName: "Mia", signature: { text: "Mia M." } });
    await h.outbox.send(id, content());
    h.advance(10_000);
    await h.due(id);
    expect(h.written[1]!.mime).toMatch(/^From: "?Mia"? <me@x\.test>\r$/m);
    expect(h.written[1]!.mime).toContain("Hi Bob\r\n\r\n-- \r\nMia M.");
  });

  test("a signature removed for one message: its draft and its send go unsigned, the next message is signed", async () => {
    const h = harness({
      identity: { displayName: null, signature: { text: "Mia M." } },
    });
    const id = newId();
    const d = await h.outbox.start(id, { kind: "new" });
    // A new draft is signed unless the person removes it.
    expect(d.content.signature).toBe(true);
    const unsigned = content({ signature: false });
    await h.outbox.save(id, unsigned);
    // The choice is kept with the draft.
    expect((await h.outbox.read(id))!.content.signature).toBe(false);
    await h.outbox.mirror(id);
    await h.outbox.send(id, unsigned);
    h.advance(10_000);
    await h.due(id);
    expect(h.written.map((w) => w.method)).toEqual(["saveDraft", "send"]);
    for (const { mime } of h.written) {
      expect(mime).toContain("Hi Bob");
      expect(mime).not.toContain("-- ");
      expect(mime).not.toContain("Mia M.");
    }
    const next = newId();
    await h.outbox.start(next, { kind: "new" });
    await h.outbox.send(next, content());
    h.advance(10_000);
    await h.due(next);
    expect(h.written[2]!.mime).toContain("Hi Bob\r\n\r\n-- \r\nMia M.");
  });

  test("an untouched compose stays empty with a signature set: never mirrored, discarded on close", async () => {
    const h = harness({
      identity: { displayName: null, signature: { text: "Mia M." } },
    });
    const id = newId();
    const d = await h.outbox.start(id, { kind: "new" });
    expect(d.content.body).toBe("");
    expect(isDraftEmpty(d.content)).toBe(true);
    // Removing the signature is no writing either.
    expect(isDraftEmpty({ ...d.content, signature: false })).toBe(true);
    await h.outbox.save(id, d.content);
    await h.outbox.mirror(id);
    expect(h.count("saveDraft")).toBe(0);
  });

  test("the signature the editor shows: the account's, as plain text; none set is null", async () => {
    const h = harness({
      identity: {
        displayName: null,
        signature: { html: "<div><b>Mia</b><br>Paris &amp; Lyon</div>" },
      },
    });
    expect(await h.outbox.signature()).toEqual({ text: "Mia\nParis & Lyon" });
    h.f.setIdentity({ displayName: null, signature: null });
    expect(await h.outbox.signature()).toEqual({ text: null });
  });

  test("a draft saved before the signature choice existed reads as signed", () => {
    const { signature: _, ...old } = content();
    expect(DraftContentSchema.parse(old).signature).toBe(true);
  });

  test("a body already signed (a draft written in the provider's editor) is not signed twice", async () => {
    const h = harness({
      identity: { displayName: null, signature: { text: "Mia M." } },
    });
    const id = newId();
    await h.outbox.start(id, { kind: "new" });
    await h.outbox.send(id, content({ body: "Hi Bob\n\n-- \nMia Moreau" }));
    h.advance(10_000);
    await h.due(id);
    expect(h.written[0]!.mime.split("-- ")).toHaveLength(2);
    expect(h.written[0]!.mime).not.toContain("Mia M.");
  });

  test("a document body goes out as HTML beside its text, in the provider's draft and in the send", async () => {
    const h = harness({
      identity: { displayName: null, signature: { text: "Mia M." } },
    });
    const id = newId();
    await h.outbox.start(id, { kind: "new" });
    const doc = content({
      body: "Hi **Bob**\n\n* one\n* two",
      bodyFormat: "document",
    });
    await h.outbox.save(id, doc);
    await h.outbox.mirror(id);
    await h.outbox.send(id, doc);
    h.advance(10_000);
    await h.due(id);
    expect(h.written.map((w) => w.method)).toEqual(["saveDraft", "send"]);
    for (const { mime } of h.written) {
      expect(mime).toContain("Content-Type: multipart/alternative");
      expect(mime).toContain(
        "Hi **Bob**\r\n\r\n* one\r\n* two\r\n\r\n-- \r\nMia M.",
      );
      expect(mime).toContain("<b>Bob</b>");
      expect(mime).toContain(
        '<ul style="margin:0"><li>one</li><li>two</li></ul>',
      );
      expect(mime).toContain('<div class=\"gmail_signature\">Mia M.</div>');
    }
  });
});

describe("send", () => {
  test("refuses no recipient, a bad address and too many bytes; the draft stays editable", async () => {
    const h = harness();
    const id = newId();
    await h.outbox.start(id, { kind: "new" });
    expect(h.outbox.send(id, content({ to: "" }))).rejects.toThrow(HttpError);
    expect(
      h.outbox.send(id, content({ to: "bob@y.test, nope" })),
    ).rejects.toThrow(/nope/);
    expect(
      h.outbox.send(
        id,
        content({
          attachments: [
            {
              kind: "upload",
              attachmentId: crypto.randomUUID(),
              filename: "big.bin",
              mimeType: "application/octet-stream",
              size: 26 * 1024 * 1024,
            },
          ],
        }),
      ),
    ).rejects.toThrow(/MB/);
    expect((await h.row(id))!.state).toBe("editing");
  });

  test("waits out the undo window, then sends once and deletes the provider draft", async () => {
    const h = harness();
    const id = newId();
    await h.outbox.start(id, { kind: "new" });
    await h.outbox.save(id, content());
    await h.outbox.mirror(id);
    const { sendAt } = await h.outbox.send(id, content());
    expect(new Date(sendAt).getTime()).toBe(
      new Date("2026-11-26T12:00:10Z").getTime(),
    );
    expect(h.sends).toEqual([{ id, at: new Date(sendAt) }]);
    // Run before its time: loud, nothing goes.
    expect(h.due(id)).rejects.toThrow(SendPendingError);
    await Bun.sleep(0);
    expect(h.count("send")).toBe(0);
    h.advance(10_000);
    await h.due(id);
    await h.due(id); // a duplicate run: nothing more
    expect(h.count("send")).toBe(1);
    const r = await h.row(id);
    expect(r!.state).toBe("sent");
    expect(r!.providerDraftId).toBeNull();
    expect(await h.draftsAtProvider()).toHaveLength(0);
    // The send carries its own Message-ID, not the draft's.
    expect(r!.sendMessageId).not.toBe(r!.draftMessageId);
  });

  test("undo inside the window takes it back to the draft; the due run sends nothing", async () => {
    const h = harness();
    const id = newId();
    await h.outbox.start(id, { kind: "new" });
    await h.outbox.send(id, content());
    expect(await h.outbox.undoSend(id)).toEqual({ kind: "reopened" });
    expect(h.mirrors).toContain(id);
    h.advance(10_000);
    await h.due(id);
    expect(h.count("send")).toBe(0);
    expect((await h.outbox.read(id))!.state).toBe("editing");
  });

  test("undone and sent again: the first send's job sends nothing, the second's sends once", async () => {
    const h = harness();
    const id = newId();
    await h.outbox.start(id, { kind: "new" });
    await h.outbox.send(id, content());
    const first = h.sends[0]!.at.toISOString();
    await h.outbox.undoSend(id);
    h.advance(5_000);
    await h.outbox.send(id, content());
    h.advance(10_000);
    await h.outbox.sendDue(id, first);
    expect(h.count("send")).toBe(0);
    await h.due(id);
    expect(h.count("send")).toBe(1);
  });

  test("undo after it went is too late", async () => {
    const h = harness();
    const id = newId();
    await h.outbox.start(id, { kind: "new" });
    await h.outbox.send(id, content());
    h.advance(10_000);
    await h.due(id);
    expect(await h.outbox.undoSend(id)).toEqual({ kind: "too-late" });
  });

  test("an answer lost after the send landed is settled by its Message-ID, never sent twice", async () => {
    const h = harness();
    const id = newId();
    await h.outbox.start(id, { kind: "new" });
    await h.outbox.send(id, content());
    h.advance(10_000);
    h.f.failNext("send", h.f.outcomeUnknown("send"), { after: true });
    expect(h.due(id)).rejects.toThrow(/may or may not/);
    await Bun.sleep(0);
    expect((await h.row(id))!.sendAttempt).toBe("unknown");
    await h.due(id);
    expect(h.count("send")).toBe(1);
    expect(h.count("findMessage")).toBe(1);
    expect((await h.row(id))!.state).toBe("sent");
  });

  test("an answer lost before it landed is looked up, never resent; given up, the draft says it may have gone", async () => {
    const h = harness();
    const id = newId();
    await h.outbox.start(id, { kind: "new" });
    await h.outbox.send(id, content());
    h.advance(10_000);
    h.f.failNext("send", h.f.outcomeUnknown("send"));
    expect(h.due(id)).rejects.toThrow(/may or may not/);
    await Bun.sleep(0);
    expect(h.due(id)).rejects.toThrow(SendPendingError);
    await Bun.sleep(0);
    expect(h.count("send")).toBe(1);
    const back = await h.outbox.sendFailed(id, "gave up");
    expect(back!.state).toBe("editing");
    expect(back!.sendError).toMatch(/may have been sent/);
  });

  test("unreachable before the provider had it: sent again on the next run", async () => {
    const h = harness();
    const id = newId();
    await h.outbox.start(id, { kind: "new" });
    await h.outbox.send(id, content());
    h.advance(10_000);
    h.f.failNext(
      "send",
      new MailUnreachableError("send", new Error("offline")),
    );
    expect(h.due(id)).rejects.toThrow(MailUnreachableError);
    await Bun.sleep(0);
    expect((await h.row(id))!.sendAttempt).toBe("not-sent");
    await h.due(id);
    expect((await h.row(id))!.state).toBe("sent");
    expect(h.count("findMessage")).toBe(0);
  });

  test("a forward carries the original's files", async () => {
    const h = harness();
    const id = newId();
    const d = await h.outbox.start(id, {
      kind: "forward",
      threadId: "t1",
      messageId: "m1",
    });
    expect(d.content.subject).toBe("Fwd: Lease");
    expect(d.content.body).toContain("Signed copy attached.");
    await h.outbox.send(id, { ...d.content, to: "carol@z.test" });
    h.advance(10_000);
    await h.due(id);
    expect((await h.row(id))!.state).toBe("sent");
  });
});

test("the drafts role exists on the fake (sanity)", () => {
  expect(DRAFTS).toBe(roleMailboxId("drafts"));
});
