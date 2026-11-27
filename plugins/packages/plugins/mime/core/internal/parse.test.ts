import { expect, test } from "bun:test";
import { buildMimeMessage } from "./build";
import { parseMimeMessage } from "./parse";

test("parseMimeMessage reads back what buildMimeMessage wrote", () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 255]);
  const mime = buildMimeMessage({
    from: { name: "Démo, D.", address: "demo@x.test" },
    to: [
      { name: "Ana", address: "ana@x.test" },
      { name: null, address: "bo@x.test" },
    ],
    cc: [{ name: "Cé", address: "ce@x.test" }],
    subject:
      "Re: Café à Lisbonne — a long subject that folds over the header line limit",
    date: new Date("2026-11-20T10:00:00Z"),
    messageId: "<m2@x.test>",
    inReplyTo: "<m1@x.test>",
    references: ["<m0@x.test>", "<m1@x.test>"],
    text: "Bonjour — à bientôt\n= not an escape",
    html: "<p>Bonjour — à bientôt</p>",
    attachments: [
      { filename: "billet été.pdf", mimeType: "application/pdf", bytes },
    ],
  });
  const m = parseMimeMessage(mime);
  expect(m.from).toEqual({ name: "Démo, D.", address: "demo@x.test" });
  expect(m.to).toEqual([
    { name: "Ana", address: "ana@x.test" },
    { name: null, address: "bo@x.test" },
  ]);
  expect(m.cc).toEqual([{ name: "Cé", address: "ce@x.test" }]);
  expect(m.subject).toBe(
    "Re: Café à Lisbonne — a long subject that folds over the header line limit",
  );
  expect(m.date?.toISOString()).toBe("2026-11-20T10:00:00.000Z");
  expect(m.messageId).toBe("<m2@x.test>");
  expect(m.inReplyTo).toBe("<m1@x.test>");
  expect(m.references).toEqual(["<m0@x.test>", "<m1@x.test>"]);
  expect(m.text).toEqual({
    content: "Bonjour — à bientôt\n= not an escape",
    unknownCharset: null,
  });
  expect(m.html?.content).toBe("<p>Bonjour — à bientôt</p>");
  expect(m.attachments).toHaveLength(1);
  expect(m.attachments[0]!.filename).toBe("billet été.pdf");
  expect(m.attachments[0]!.mimeType).toBe("application/pdf");
  expect([...m.attachments[0]!.bytes]).toEqual([...bytes]);
  expect(m.attachments[0]!.inline).toBe(false);
});

test("a text-only message, and an inline image by Content-ID", () => {
  expect(
    parseMimeMessage(
      new TextEncoder().encode(
        "From: a@x.test\r\nSubject: hi\r\n\r\nplain body\r\n",
      ),
    ),
  ).toMatchObject({
    text: { content: "plain body", unknownCharset: null },
    html: null,
    attachments: [],
  });
  const raw = [
    'Content-Type: multipart/related; boundary="b"',
    "",
    "--b",
    "Content-Type: text/html",
    "",
    '<img src="cid:pic">',
    "--b",
    "Content-Type: image/png",
    "Content-ID: <pic>",
    "Content-Transfer-Encoding: base64",
    "",
    "AAEC",
    "--b--",
  ].join("\r\n");
  const m = parseMimeMessage(new TextEncoder().encode(raw));
  expect(m.html?.content).toBe('<img src="cid:pic">');
  expect(m.attachments).toMatchObject([
    { contentId: "pic", inline: true, mimeType: "image/png" },
  ]);
  expect([...m.attachments[0]!.bytes]).toEqual([0, 1, 2]);
});

test("a charset no decoder knows is named, its bytes read as UTF-8", () => {
  const m = parseMimeMessage(
    new TextEncoder().encode(
      'Content-Type: text/plain; charset="x-nope"\r\n\r\nhello\r\n',
    ),
  );
  expect(m.text).toEqual({ content: "hello", unknownCharset: "x-nope" });
});
