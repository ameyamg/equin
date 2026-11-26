import { describe, expect, test } from "bun:test";
import { buildMimeMessage, newMessageId } from "./build";
import {
  encodeQuotedPrintable,
  encodeWord,
  foldHeader,
  formatAddress,
} from "./encode";

const text = (b: Uint8Array) => new TextDecoder().decode(b);

/** The decoded value of every encoded-word in a header value. */
function decodeWords(v: string): string {
  return v.replace(/=\?UTF-8\?B\?([^?]+)\?=\s*/g, (_, b64: string) =>
    new TextDecoder().decode(
      Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
    ),
  );
}

/** Quoted-printable decoded back to text. */
function decodeQp(qp: string): string {
  const joined = qp.replace(/=\r\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    if (joined[i] === "=") {
      bytes.push(parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(joined.charCodeAt(i));
  }
  return new TextDecoder().decode(new Uint8Array(bytes)).replace(/\r\n/g, "\n");
}

const base = {
  from: { name: "Ana Example", address: "ana@example.com" },
  to: [{ name: null, address: "bob@example.com" }],
  subject: "Hello",
  date: new Date("2026-11-26T20:15:00Z"),
  messageId: "<abc@example.com>",
  text: "Hi Bob",
};

describe("encodeWord", () => {
  test("plain ASCII is left as is", () => {
    expect(encodeWord("Lease renewal")).toBe("Lease renewal");
  });
  test("non-ASCII becomes encoded-words of at most 75 characters, split between code points", () => {
    const s = "Réunion — ".repeat(12) + "🎉";
    const enc = encodeWord(s);
    for (const w of enc.split(" ")) expect(w.length).toBeLessThanOrEqual(75);
    expect(decodeWords(enc)).toBe(s);
  });
  test("text that looks like an encoded-word is encoded", () => {
    expect(encodeWord("=?x?=")).toStartWith("=?UTF-8?B?");
  });
});

describe("formatAddress", () => {
  test("a bare address, a plain name, a quoted name, an encoded name", () => {
    expect(formatAddress({ name: null, address: "a@b.c" })).toBe("a@b.c");
    expect(formatAddress({ name: "Ana", address: "a@b.c" })).toBe(
      "Ana <a@b.c>",
    );
    expect(formatAddress({ name: 'Doe, "J"', address: "a@b.c" })).toBe(
      '"Doe, \\"J\\"" <a@b.c>',
    );
    expect(decodeWords(formatAddress({ name: "Zoë", address: "a@b.c" }))).toBe(
      "Zoë<a@b.c>",
    );
  });
  test("refuses what is not an address", () => {
    expect(() => formatAddress({ name: null, address: "nope" })).toThrow();
    expect(() =>
      formatAddress({ name: null, address: "a@b.c>\r\nBcc: x@y.z" }),
    ).toThrow();
  });
});

describe("foldHeader", () => {
  test("folds at whitespace to 78 columns", () => {
    const v = Array.from(
      { length: 20 },
      (_, i) => `person${i}@example.com`,
    ).join(", ");
    const folded = foldHeader("To", v);
    for (const line of folded.split("\r\n"))
      expect(line.length).toBeLessThanOrEqual(78);
    expect(folded.replace(/\r\n /g, " ")).toBe(`To: ${v}`);
  });
  test("refuses a line break: no header injection", () => {
    expect(() => foldHeader("Subject", "a\r\nBcc: x@y.z")).toThrow();
  });
});

describe("encodeQuotedPrintable", () => {
  test("round-trips UTF-8, escapes =, keeps lines ≤ 76", () => {
    const s = `Ça va? 1 + 1 = 2\n${"long line ".repeat(20)}\ntrailing space \nend`;
    const qp = encodeQuotedPrintable(s);
    for (const line of qp.split("\r\n"))
      expect(line.length).toBeLessThanOrEqual(76);
    expect(qp).toContain("=3D");
    expect(qp).toContain("space=20");
    expect(decodeQp(qp)).toBe(s);
  });
});

describe("buildMimeMessage", () => {
  test("a text message: headers, then the quoted-printable body", () => {
    const out = text(buildMimeMessage({ ...base, text: "Hi Bob,\nsee you" }));
    const [head, body] = out.split("\r\n\r\n");
    expect(head).toContain("From: Ana Example <ana@example.com>");
    expect(head).toContain("To: bob@example.com");
    expect(head).toContain("Subject: Hello");
    expect(head).toContain("Date: Thu, 26 Nov 2026 20:15:00 +0000");
    expect(head).toContain("Message-ID: <abc@example.com>");
    expect(head).toContain("MIME-Version: 1.0");
    expect(head).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(head).not.toContain("In-Reply-To");
    expect(body).toBe("Hi Bob,\r\nsee you\r\n");
    expect(out).not.toMatch(/[^\r]\n/);
  });

  test("a reply carries In-Reply-To and References", () => {
    const out = text(
      buildMimeMessage({
        ...base,
        inReplyTo: "<p2@x.com>",
        references: ["<p1@x.com>", "<p2@x.com>"],
        cc: [{ name: null, address: "c@x.com" }],
        bcc: [{ name: null, address: "d@x.com" }],
      }),
    );
    expect(out).toContain("In-Reply-To: <p2@x.com>");
    expect(out).toContain("References: <p1@x.com> <p2@x.com>");
    expect(out).toContain("Cc: c@x.com");
    expect(out).toContain("Bcc: d@x.com");
  });

  test("attachments make it multipart/mixed, each part base64 with its filename", () => {
    const bytes = new Uint8Array(200).map((_, i) => i);
    const out = text(
      buildMimeMessage({
        ...base,
        attachments: [
          {
            filename: "notes.bin",
            mimeType: "application/octet-stream",
            bytes,
          },
          {
            filename: "Résumé.pdf",
            mimeType: "application/pdf",
            bytes: new Uint8Array([1]),
          },
        ],
      }),
    );
    const b = /boundary="([^"]+)"/.exec(out)![1]!;
    expect(out).toContain("Content-Type: multipart/mixed");
    expect(out.split(`--${b}`).length).toBe(5); // preamble, 3 parts, the close
    expect(out).toContain(`--${b}--`);
    expect(out).toContain('filename="notes.bin"');
    expect(out).toContain("filename*=UTF-8''R%C3%A9sum%C3%A9.pdf");
    const b64 = out
      .split('filename="notes.bin"')[1]!
      .split("\r\n\r\n")[1]!
      .split("\r\n--")[0]!;
    for (const line of b64.split("\r\n"))
      expect(line.length).toBeLessThanOrEqual(76);
    expect(
      Uint8Array.from(atob(b64.replace(/\r\n/g, "")), (c) => c.charCodeAt(0)),
    ).toEqual(bytes);
  });

  test("an HTML alternative makes it multipart/alternative", () => {
    const out = text(buildMimeMessage({ ...base, html: "<p>Hi</p>" }));
    expect(out).toContain("multipart/alternative");
    expect(out).toContain("text/html");
  });

  test("refuses a malformed Message-ID", () => {
    expect(() => buildMimeMessage({ ...base, messageId: "abc" })).toThrow();
    expect(() => buildMimeMessage({ ...base, inReplyTo: "x y" })).toThrow();
  });

  test("a subject's line break becomes a space", () => {
    expect(text(buildMimeMessage({ ...base, subject: "a\nb" }))).toContain(
      "Subject: a b",
    );
  });
});

test("newMessageId mints a fresh id at the domain", () => {
  const a = newMessageId("example.com");
  expect(a).toMatch(/^<[0-9a-f-]+@example\.com>$/);
  expect(newMessageId("example.com")).not.toBe(a);
  expect(() => newMessageId("bad domain")).toThrow();
});
