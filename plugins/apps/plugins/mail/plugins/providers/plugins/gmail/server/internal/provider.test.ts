import { describe, expect, test } from "bun:test";
import { createQuotaPacer } from "@plugins/integrations/plugins/gmail/plugins/api/core";
import { createGmailClient } from "@plugins/integrations/plugins/gmail/plugins/api/server";
import {
  changeCursor,
  MailNotConnectedError,
  MailOutcomeUnknownError,
  MailUnreachableError,
  nativeMailboxId,
  providerQuery,
  roleMailboxId,
  threadId,
} from "@plugins/apps/plugins/mail/plugins/provider/core";
import { HISTORY_PAGES_PER_CALL, createGmailMailProvider } from "./provider";

// Gmail answers in Google's wire shape (int64s as strings, batch multipart with
// CRLF and `response-` Content-IDs), made-up content, through the real client
// and pacer: only `fetch` is replaced.

type Req = {
  method: string;
  path: string;
  query: URLSearchParams;
  body: string;
};
/** Gmail's base64url body encoding. */
const encodeBase64Url = (b: Uint8Array) => Buffer.from(b).toString("base64url");

/** A JSON answer that keeps its text, so a batch can embed it as a part. */
type Canned = Response & { text_: string };
const json = (status: number, body: unknown): Canned => {
  const text = JSON.stringify(body);
  return Object.assign(
    new Response(text, {
      status,
      headers: { "Content-Type": "application/json; charset=UTF-8" },
    }),
    { text_: text },
  );
};
const err = (status: number, reason: string, message = reason) =>
  json(status, {
    error: {
      code: status,
      message,
      errors: [{ reason, message, domain: "global" }],
    },
  });

/** Answers a batch request part by part: each part's request line is routed like a plain call. */
function batch(req: Req, route: (r: Req) => Response): Response {
  const lines = [
    ...req.body.matchAll(/^(GET|POST|PUT|DELETE) (\S+) HTTP\/1\.1$/gm),
  ];
  const out = "batch_out";
  let body = "";
  lines.forEach((m, i) => {
    const url = new URL(`https://gmail.googleapis.com${m[2]!}`);
    const res = route({
      method: m[1]!,
      path: url.pathname,
      query: url.searchParams,
      body: "",
    });
    const text = (res as Canned).text_;
    body += `--${out}\r\nContent-Type: application/http\r\nContent-ID: <response-item-${i}>\r\n\r\n`;
    body += `HTTP/1.1 ${res.status} X\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${text}\r\n`;
  });
  return new Response(`${body}--${out}--\r\n`, {
    status: 200,
    headers: { "Content-Type": `multipart/mixed; boundary=${out}` },
  });
}

function gmail(
  route: (r: Req) => Response | undefined,
  o: { refusedToken?: boolean } = {},
) {
  const sent: Req[] = [];
  const answer = (r: Req): Response => {
    const res = route(r);
    if (!res) throw new Error(`unexpected ${r.method} ${r.path}?${r.query}`);
    return res;
  };
  const fetch = async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const body =
      typeof init.body === "string"
        ? init.body
        : init.body instanceof Uint8Array
          ? new TextDecoder().decode(init.body)
          : "";
    const req = {
      method: init.method ?? "GET",
      path: u.pathname,
      query: u.searchParams,
      body,
    };
    sent.push(req);
    return u.pathname === "/batch/gmail/v1" ? batch(req, answer) : answer(req);
  };
  const client = createGmailClient({
    accessToken: async () => {
      if (o.refusedToken) return "revoked";
      return "tok";
    },
    pacer: createQuotaPacer(),
    fetch,
    retry: { attempts: 1 },
  });
  return { provider: createGmailMailProvider(client), sent };
}

const ME = "/gmail/v1/users/me";
const msg = (o: {
  id: string;
  thread: string;
  labels: string[];
  at: string;
  from: string;
  to?: string;
  subject?: string;
  mime?: string;
  extra?: object;
}) => ({
  id: o.id,
  threadId: o.thread,
  labelIds: o.labels,
  snippet: `snippet ${o.id}`,
  historyId: "100",
  internalDate: o.at,
  payload: {
    partId: "",
    mimeType: o.mime ?? "multipart/alternative",
    filename: "",
    headers: [
      { name: "From", value: o.from },
      ...(o.to === undefined ? [] : [{ name: "To", value: o.to }]),
      ...(o.subject === undefined
        ? []
        : [{ name: "Subject", value: o.subject }]),
    ],
    body: { size: 0 },
    ...o.extra,
  },
});

const THREAD_A = {
  id: "ta",
  historyId: "501",
  messages: [
    msg({
      id: "a1",
      thread: "ta",
      labels: ["INBOX", "CATEGORY_PERSONAL"],
      at: "1767312000000",
      from: "=?UTF-8?B?w4lsaWU=?= <elie@x.test>",
      to: "Bo <bo@x.test>, cy@x.test",
      subject: "=?UTF-8?Q?Caf=C3=A9?=",
    }),
    msg({
      id: "a2",
      thread: "ta",
      labels: ["INBOX", "UNREAD", "Label_7"],
      at: "1767315600000",
      from: "bo@x.test",
      to: "CY@x.test",
      mime: "multipart/mixed",
    }),
    msg({
      id: "a3",
      thread: "ta",
      labels: ["DRAFT"],
      at: "1767399999000",
      from: "me@x.test",
    }),
  ],
};

describe("Gmail provider: reads", () => {
  test("getThreads: one metadata batch; labels become mailboxes and flags; a deleted thread is gone", async () => {
    const g = gmail((r) => {
      if (r.path === `${ME}/threads/ta`) {
        expect(r.query.get("format")).toBe("metadata");
        expect(r.query.getAll("metadataHeaders")).toEqual([
          "From",
          "To",
          "Subject",
          "Content-Type",
        ]);
        return json(200, THREAD_A);
      }
      if (r.path === `${ME}/threads/gone`) return err(404, "notFound");
    });
    const [a, gone] = await g.provider.getThreads([
      threadId("ta"),
      threadId("gone"),
    ]);
    expect(gone).toEqual({ id: threadId("gone"), kind: "gone" });
    if (!a || a.kind !== "found") throw new Error("not found");
    expect(a.summary).toMatchObject({
      version: "501",
      subject: "Café",
      snippet: "snippet a3",
      messageCount: 3,
      unread: true,
      starred: false,
      hasDraft: true,
      hasAttachments: true,
      // The draft's later date is not the thread's.
      lastMessageAt: new Date(1767315600000),
      participants: [
        { name: "Élie", address: "elie@x.test" },
        { name: null, address: "bo@x.test" },
        { name: null, address: "me@x.test" },
      ],
      // To, deduped by address whatever its case.
      recipients: [
        { name: "Bo", address: "bo@x.test" },
        { name: null, address: "cy@x.test" },
      ],
    });
    expect(a.summary.mailboxes).toEqual(
      [
        nativeMailboxId("CATEGORY_PERSONAL"),
        nativeMailboxId("Label_7"),
        roleMailboxId("drafts"),
        roleMailboxId("inbox"),
      ].sort(),
    );
    // Per-message facts, for a per-message re-check over the cache.
    expect(
      a.summary.messages.map((m) => [
        m.id as string,
        m.unread,
        m.isDraft,
        m.mailboxes,
      ]),
    ).toEqual([
      [
        "a1",
        false,
        false,
        [nativeMailboxId("CATEGORY_PERSONAL"), roleMailboxId("inbox")],
      ],
      ["a2", true, false, [nativeMailboxId("Label_7"), roleMailboxId("inbox")]],
      ["a3", false, true, [roleMailboxId("drafts")]],
    ]);
    expect(g.sent).toHaveLength(1);
  });

  test("listMessages: the compiled q with the cut, spam and trash included, the page token", async () => {
    const g = gmail((r) => {
      if (r.path === `${ME}/messages`) {
        return json(200, {
          messages: [{ id: "ma", threadId: "ta" }],
          nextPageToken: "p2",
          resultSizeEstimate: 9,
        });
      }
    });
    const page = await g.provider.listMessages(
      providerQuery("in:inbox is:unread"),
      {
        olderThan: new Date("2026-01-02T00:00:00.400Z"),
        limit: 50,
        cursor: null,
      },
    );
    expect(page).toEqual({
      hits: [{ thread: threadId("ta"), message: "ma" as never }],
      next: "p2" as never,
    });
    const q = g.sent[0]!.query;
    // The cut's second rounded up: a superset, never fewer.
    expect(q.get("q")).toBe("in:inbox is:unread before:1767312001");
    expect(q.get("includeSpamTrash")).toBe("true");
    expect(q.get("maxResults")).toBe("50");
  });

  test("getThreadContent: bodies in their charset, attachments by id or inline, a large body fetched", async () => {
    const latin1 = Uint8Array.from([0x43, 0x61, 0x66, 0xe9]); // "Café" in ISO-8859-1
    const full = {
      id: "tc",
      historyId: "77",
      messages: [
        msg({
          id: "c1",
          thread: "tc",
          labels: ["INBOX", "STARRED"],
          at: "1767312000000",
          from: '"Doe, Ana" <ana@x.test>',
          subject: "Hi",
          mime: "multipart/mixed",
          extra: {
            headers: [
              { name: "From", value: '"Doe, Ana" <ana@x.test>' },
              { name: "To", value: "bo@x.test, Cy <cy@x.test>" },
              { name: "Subject", value: "Hi" },
              { name: "Message-ID", value: "<c1@x.test>" },
              { name: "References", value: "<r1@x> <r2@x>" },
            ],
            parts: [
              {
                partId: "0",
                mimeType: "multipart/alternative",
                filename: "",
                body: { size: 0 },
                parts: [
                  {
                    partId: "0.0",
                    mimeType: "text/plain",
                    filename: "",
                    headers: [
                      {
                        name: "Content-Type",
                        value: "text/plain; charset=ISO-8859-1",
                      },
                    ],
                    body: { size: 4, data: encodeBase64Url(latin1) },
                  },
                  {
                    partId: "0.1",
                    mimeType: "text/html",
                    filename: "",
                    headers: [
                      {
                        name: "Content-Type",
                        value: 'text/html; charset="x-unknown"',
                      },
                    ],
                    body: { size: 9, attachmentId: "BIGHTML" },
                  },
                ],
              },
              {
                partId: "1",
                mimeType: "application/pdf",
                filename: "q3.pdf",
                headers: [
                  {
                    name: "Content-Disposition",
                    value: 'attachment; filename="q3.pdf"',
                  },
                ],
                body: { size: 1000, attachmentId: "ATT1" },
              },
              {
                partId: "2",
                mimeType: "image/png",
                filename: "",
                headers: [
                  { name: "Content-ID", value: "<logo@x>" },
                  { name: "Content-Disposition", value: "inline" },
                ],
                body: {
                  size: 3,
                  data: encodeBase64Url(Uint8Array.from([1, 2, 3])),
                },
              },
            ],
          },
        }),
      ],
    };
    const g = gmail((r) => {
      if (r.path === `${ME}/threads/tc`) return json(200, full);
      if (r.path === `${ME}/messages/c1/attachments/BIGHTML`)
        return json(200, {
          size: 9,
          data: encodeBase64Url(new TextEncoder().encode("<b>hi</b>")),
        });
      if (r.path === `${ME}/messages/c1`) return json(200, full.messages[0]);
    });
    const r = await g.provider.getThreadContent(threadId("tc"));
    if (r.kind !== "found") throw new Error("gone");
    const m = r.content.messages[0]!;
    expect(m.text).toEqual({ content: "Café", unknownCharset: null });
    expect(m.html).toEqual({
      content: "<b>hi</b>",
      unknownCharset: "x-unknown",
    });
    expect(m.to.map((p) => p.address)).toEqual(["bo@x.test", "cy@x.test"]);
    expect(m.from).toEqual({ name: "Doe, Ana", address: "ana@x.test" });
    expect(m.references).toEqual(["<r1@x>", "<r2@x>"]);
    expect(m.rfc822MessageId).toBe("<c1@x.test>");
    expect(m.starred).toBe(true);
    expect(
      m.attachments.map((a) => [
        a.filename,
        a.ref.partId,
        a.inline,
        a.contentId,
      ]),
    ).toEqual([
      ["q3.pdf", "1", false, null],
      ["", "2", true, "logo@x"],
    ]);
    // An inline attachment's bytes are re-read from the message.
    const logo = await g.provider.getAttachment(m.attachments[1]!.ref);
    expect([...logo]).toEqual([1, 2, 3]);
  });

  test("the MIME walk: a body split around an image is joined; a forwarded message and an invite are attachments", async () => {
    const enc = (t: string) => encodeBase64Url(new TextEncoder().encode(t));
    const part = (o: object) => ({ filename: "", body: { size: 0 }, ...o });
    const full = {
      id: "tm",
      historyId: "9",
      messages: [
        msg({
          id: "m1",
          thread: "tm",
          labels: ["INBOX"],
          at: "1767312000000",
          from: "a@x.test",
          mime: "multipart/mixed",
          extra: {
            parts: [
              part({
                partId: "0",
                mimeType: "text/html",
                body: { size: 5, data: enc("<p>a</p>") },
              }),
              part({
                partId: "1",
                mimeType: "image/png",
                headers: [{ name: "Content-ID", value: "<i1>" }],
                body: { size: 3, data: enc("png") },
              }),
              part({
                partId: "2",
                mimeType: "text/html",
                body: { size: 5, data: enc("<p>b</p>") },
              }),
              part({
                partId: "3",
                mimeType: "text/calendar",
                body: { size: 4, data: enc("VCAL") },
              }),
              part({
                partId: "4",
                mimeType: "message/rfc822",
                filename: "fwd.eml",
                body: { size: 50, attachmentId: "FWD" },
                parts: [
                  part({
                    partId: "4.0",
                    mimeType: "text/plain",
                    body: { size: 5, data: enc("inner") },
                  }),
                ],
              }),
            ],
          },
        }),
      ],
    };
    const g = gmail((r) =>
      r.path === `${ME}/threads/tm` ? json(200, full) : undefined,
    );
    const r = await g.provider.getThreadContent(threadId("tm"));
    if (r.kind !== "found") throw new Error("gone");
    const m = r.content.messages[0]!;
    expect(m.html?.content).toBe("<p>a</p>\n<p>b</p>");
    // The forwarded message's own body is not this message's.
    expect(m.text).toBeNull();
    expect(m.attachments.map((a) => [a.mimeType, a.ref.handle])).toEqual([
      ["image/png", "inline-part:1"],
      ["text/calendar", "inline-part:3"],
      ["message/rfc822", "FWD"],
    ]);
  });

  test("listMailboxes: counts in one batch, flags left out, nested labels parented", async () => {
    const labels = [
      { id: "INBOX", name: "INBOX", type: "system" },
      { id: "UNREAD", name: "UNREAD", type: "system" },
      { id: "STARRED", name: "STARRED", type: "system" },
      { id: "Label_1", name: "Work", type: "user" },
      {
        id: "Label_2",
        name: "Work/Clients",
        type: "user",
        color: { textColor: "#fff", backgroundColor: "#000" },
      },
    ];
    const g = gmail((r) => {
      if (r.path === `${ME}/labels`) return json(200, { labels });
      const id = /labels\/(.+)$/.exec(r.path)?.[1];
      const l = labels.find((x) => x.id === id);
      if (l) return json(200, { ...l, threadsTotal: 4, threadsUnread: 1 });
    });
    const boxes = await g.provider.listMailboxes();
    expect(boxes.map((b) => [b.id, b.name, b.role, b.parentId])).toEqual([
      ["role:inbox", "Inbox", "inbox", null],
      ["Label_1", "Work", null, null],
      ["Label_2", "Clients", null, "Label_1"],
    ]);
    expect(boxes[2]!.counts).toEqual({ threads: 4, unread: 1 });
    expect(boxes[2]!.color).toEqual({ text: "#fff", background: "#000" });
    // labels.list, then one batch for the three mailboxes' counts.
    expect(g.sent).toHaveLength(2);
  });
});

describe("Gmail provider: changes", () => {
  const rec = (id: string, thread: string) => ({
    id,
    messages: [{ id: `m${id}`, threadId: thread }],
    labelsAdded: [
      { message: { id: `m${id}`, threadId: thread }, labelIds: ["STARRED"] },
    ],
  });

  test("pages until done; the next cursor is the mailbox's", async () => {
    const g = gmail((r) => {
      if (r.path !== `${ME}/history`) return undefined;
      return r.query.get("pageToken") === null
        ? json(200, {
            history: [rec("11", "t1"), rec("12", "t2")],
            nextPageToken: "n",
            historyId: "20",
          })
        : json(200, { history: [rec("13", "t1")], historyId: "20" });
    });
    expect(await g.provider.changesSince(changeCursor("10"))).toEqual({
      kind: "changes",
      threads: [threadId("t1"), threadId("t2")],
      mailboxes: "changed",
      next: changeCursor("20"),
      more: false,
    });
  });

  test("a cursor Gmail no longer has is a reset", async () => {
    const g = gmail((r) =>
      r.path === `${ME}/history` ? err(404, "notFound") : undefined,
    );
    expect(await g.provider.changesSince(changeCursor("1"))).toEqual({
      kind: "reset",
    });
  });

  test("past the page budget, more: true and the cursor resumes after the last record read", async () => {
    let n = 0;
    const g = gmail((r) => {
      if (r.path !== `${ME}/history`) return undefined;
      n++;
      return json(200, {
        history: [rec(String(100 + n), `t${n}`)],
        nextPageToken: `p${n}`,
        historyId: "999",
      });
    });
    const c = await g.provider.changesSince(changeCursor("100"));
    expect(c).toMatchObject({
      kind: "changes",
      more: true,
      next: String(100 + HISTORY_PAGES_PER_CALL),
    });
    expect(n).toBe(HISTORY_PAGES_PER_CALL);
  });
});

describe("Gmail provider: writes", () => {
  const mime = (id: string) =>
    new TextEncoder().encode(`Message-ID: ${id}\r\nSubject: Hi\r\n\r\nbody`);

  test("archive removes INBOX from each thread", async () => {
    const g = gmail((r) =>
      r.path.endsWith("/modify")
        ? json(200, { id: "x", historyId: "1" })
        : undefined,
    );
    await g.provider.archive([threadId("t1"), threadId("t2")]);
    expect(g.sent.map((s) => [s.path, JSON.parse(s.body)])).toEqual([
      [`${ME}/threads/t1/modify`, { removeLabelIds: ["INBOX"] }],
      [`${ME}/threads/t2/modify`, { removeLabelIds: ["INBOX"] }],
    ]);
  });

  test("a send whose answer was lost is resolved by its Message-ID, never resent", async () => {
    const found = gmail((r) => {
      if (r.path.endsWith("/messages/send")) return err(503, "backendError");
      if (r.path === `${ME}/messages`) {
        expect(r.query.get("q")).toBe("rfc822msgid:s1@x.test");
        return json(200, {
          messages: [{ id: "m9", threadId: "t9" }],
          resultSizeEstimate: 1,
        });
      }
    });
    expect(
      await found.provider.send({
        mime: mime("<s1@x.test>"),
        threadId: null,
        rfc822MessageId: "<s1@x.test>",
      }),
    ).toEqual({ messageId: "m9" as never, threadId: threadId("t9") });
    expect(found.sent.filter((s) => s.path.endsWith("/send"))).toHaveLength(1);

    const lost = gmail((r) => {
      if (r.path.endsWith("/messages/send")) return err(503, "backendError");
      if (r.path === `${ME}/messages`)
        return json(200, { resultSizeEstimate: 0 });
    });
    const e = await lost.provider
      .send({
        mime: mime("<s2@x.test>"),
        threadId: null,
        rfc822MessageId: "<s2@x.test>",
      })
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(MailOutcomeUnknownError);
    expect(lost.sent.filter((s) => s.path.endsWith("/send"))).toHaveLength(1);
  });

  test("a send whose lookup fails too stays outcome-unknown, never unreachable", async () => {
    let sends = 0;
    const client = createGmailClient({
      accessToken: async () => "tok",
      pacer: createQuotaPacer(),
      // The connection drops on the send, and stays down for the lookup.
      fetch: (url) => {
        if (url.includes("/messages/send")) sends++;
        return Promise.reject(new TypeError("connection reset"));
      },
      retry: { attempts: 1 },
    });
    const e = await createGmailMailProvider(client)
      .send({
        mime: mime("<s3@x.test>"),
        threadId: null,
        rfc822MessageId: "<s3@x.test>",
      })
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(MailOutcomeUnknownError);
    expect(sends).toBe(1);
  });

  test("an outgoing message must carry the Message-ID it is reconciled by", async () => {
    const g = gmail(() => undefined);
    expect(
      g.provider.send({
        mime: mime("<a@x>"),
        threadId: null,
        rfc822MessageId: "<b@x>",
      }),
    ).rejects.toThrow("Message-ID");
  });

  test("creating a label that exists (409) answers the existing one", async () => {
    const g = gmail((r) => {
      if (r.path === `${ME}/labels` && r.method === "GET")
        return json(200, {
          labels: [
            { id: "Label_1", name: "Work", type: "user" },
            { id: "Label_5", name: "Work/New", type: "user" },
          ],
        });
      if (r.path === `${ME}/labels` && r.method === "POST")
        return err(409, "duplicate", "Label name exists or conflicts");
    });
    const m = await g.provider.createMailbox({
      name: "New",
      parentId: nativeMailboxId("Label_1"),
    });
    expect(m).toMatchObject({
      id: "Label_5",
      name: "New",
      parentId: "Label_1",
    });
  });
});

describe("Gmail provider: failures in the contract's words", () => {
  test("unreachable Gmail is MailUnreachableError", async () => {
    const client = createGmailClient({
      accessToken: async () => "tok",
      pacer: createQuotaPacer(),
      fetch: () => Promise.reject(new TypeError("fetch failed")),
      retry: { attempts: 1 },
    });
    const e = await createGmailMailProvider(client)
      .currentCursor()
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(MailUnreachableError);
  });

  test("a token Gmail keeps refusing is MailNotConnectedError", async () => {
    const g = gmail(
      (r) => (r.path === `${ME}/profile` ? err(401, "authError") : undefined),
      { refusedToken: true },
    );
    const e = await g.provider.currentCursor().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(MailNotConnectedError);
    expect((e as MailNotConnectedError).needsConsent).toBe(true);
  });
});
