import { describe, expect, test } from "bun:test";
import {
  messageId,
  type MessageContent,
} from "@plugins/apps/plugins/mail/plugins/provider/core";
import { formatAddressList, parseAddressList } from "./addresses";
import {
  messageIdsIn,
  messageText,
  plainTextOf,
  prefixedSubject,
  signatureText,
  startFrom,
} from "./reply";

const ME = "me@example.com";

function message(over: Partial<MessageContent> = {}): MessageContent {
  return {
    id: messageId("m2"),
    from: { name: "Ana Example", address: "ana@x.com" },
    to: [
      { name: null, address: ME },
      { name: "Bob", address: "bob@y.org" },
    ],
    cc: [{ name: null, address: "carol@z.io" }],
    bcc: [],
    replyTo: [],
    subject: "Lease renewal",
    date: new Date("2026-11-25T09:30:00Z"),
    rfc822MessageId: "<p2@x.com>",
    inReplyTo: "<p1@x.com>",
    references: ["<p1@x.com>"],
    mailboxes: [],
    unread: false,
    starred: false,
    isDraft: false,
    text: { content: "Hi,\n\nSigned copy attached.", unknownCharset: null },
    html: null,
    attachments: [
      {
        ref: { messageId: messageId("m2"), partId: "1", handle: "h1" },
        filename: "lease.pdf",
        mimeType: "application/pdf",
        size: 1200,
        contentId: null,
        inline: false,
      },
      {
        ref: { messageId: messageId("m2"), partId: "2", handle: "h2" },
        filename: "logo.png",
        mimeType: "image/png",
        size: 50,
        contentId: "logo",
        inline: true,
      },
    ],
    ...over,
  };
}

describe("parseAddressList", () => {
  test("names, quoted names with commas, bare addresses, both separators", () => {
    const p = parseAddressList('Ana <ana@x.com>, "Doe, J" <j@y.org>; bob@z.io');
    expect(p).toEqual({
      kind: "ok",
      addresses: [
        { name: "Ana", address: "ana@x.com" },
        { name: "Doe, J", address: "j@y.org" },
        { name: null, address: "bob@z.io" },
      ],
    });
  });
  test("names what is not an address instead of dropping it", () => {
    const p = parseAddressList("ana@x.com, nope, ");
    expect(p.kind).toBe("invalid");
    if (p.kind === "invalid") {
      expect(p.invalid).toEqual(["nope"]);
      expect(p.addresses).toEqual([{ name: null, address: "ana@x.com" }]);
    }
  });
  test("formatAddressList round-trips", () => {
    const list = [
      { name: "Doe, J", address: "j@y.org" },
      { name: null, address: "b@z.io" },
    ];
    const p = parseAddressList(formatAddressList(list));
    expect(p).toEqual({ kind: "ok", addresses: list });
  });
});

describe("startFrom", () => {
  test("reply: to the sender, Re:, threaded, the message quoted", () => {
    const c = startFrom("reply", message(), ME, "t1");
    expect(c.to).toBe("Ana Example <ana@x.com>");
    expect(c.cc).toBe("");
    expect(c.subject).toBe("Re: Lease renewal");
    expect(c.inReplyTo).toBe("<p2@x.com>");
    expect(c.references).toEqual(["<p1@x.com>", "<p2@x.com>"]);
    expect(c.quote).toContain("Ana Example <ana@x.com> wrote:");
    expect(c.quote).toContain("> Signed copy attached.");
    expect(c.body).toBe("");
    expect(c.replyingTo?.name).toBe("Ana Example");
  });
  test("reply goes to Reply-To when the message names one", () => {
    const c = startFrom(
      "reply",
      message({ replyTo: [{ name: null, address: "list@x.com" }] }),
      ME,
      "t1",
    );
    expect(c.to).toBe("list@x.com");
  });
  test("reply all: every other recipient in Cc, you left out, no duplicates", () => {
    const c = startFrom(
      "reply-all",
      message({
        cc: [
          { name: null, address: "carol@z.io" },
          { name: null, address: "ANA@x.com" },
        ],
      }),
      ME,
      "t1",
    );
    expect(c.to).toBe("Ana Example <ana@x.com>");
    expect(c.cc).toBe("Bob <bob@y.org>, carol@z.io");
  });
  test("answering your own message follows up with its recipients", () => {
    const c = startFrom(
      "reply-all",
      message({ from: { name: null, address: ME } }),
      ME,
      "t1",
    );
    expect(c.to).toBe("Bob <bob@y.org>");
    expect(c.cc).toBe("carol@z.io");
  });
  test("following up on a note to yourself answers you again", () => {
    const c = startFrom(
      "reply",
      message({
        from: { name: null, address: ME },
        to: [{ name: null, address: ME }],
        cc: [],
      }),
      ME,
      "t1",
    );
    expect(c.to).toBe(ME);
  });
  test("an existing Re: is not doubled", () => {
    expect(prefixedSubject("reply", "RE: x")).toBe("RE: x");
    expect(prefixedSubject("forward", "Fwd: x")).toBe("Fwd: x");
    expect(prefixedSubject("forward", "x")).toBe("Fwd: x");
  });
  test("forward: nobody yet, the message in the body, its files but not inline images", () => {
    const c = startFrom("forward", message(), ME, "t1");
    expect(c.to).toBe("");
    expect(c.subject).toBe("Fwd: Lease renewal");
    expect(c.body).toContain("---------- Forwarded message ---------");
    expect(c.body).toContain("From: Ana Example <ana@x.com>");
    expect(c.body).toContain("Signed copy attached.");
    expect(c.quote).toBeNull();
    expect(c.attachments).toEqual([
      {
        kind: "forwarded",
        threadId: "t1",
        messageId: "m2",
        partId: "1",
        filename: "lease.pdf",
        mimeType: "application/pdf",
        size: 1200,
      },
    ]);
  });
});

test("plainTextOf reads HTML when there is no text part", () => {
  expect(
    plainTextOf({
      text: null,
      html: {
        content: "<style>p{}</style><p>Hello&nbsp;there</p><p>Line<br>two</p>",
        unknownCharset: null,
      },
    }),
  ).toBe("Hello there\nLine\ntwo");
});

test("odd threading headers keep only their Message-IDs", () => {
  expect(messageIdsIn("<a@x>,<b@y> (Ana's message)")).toEqual([
    "<a@x>",
    "<b@y>",
  ]);
  expect(messageIdsIn("no-at-sign")).toEqual([]);
  const c = startFrom(
    "reply",
    message({
      rfc822MessageId: "<p2@x.com> (comment)",
      references: ["<p1@x.com>,<p0@x.com>", "junk"],
    }),
    ME,
    "t1",
  );
  expect(c.inReplyTo).toBe("<p2@x.com>");
  expect(c.references).toEqual(["<p1@x.com>", "<p0@x.com>", "<p2@x.com>"]);
});

describe("signature and message text", () => {
  test("an HTML signature as plain text; empty is none", () => {
    expect(
      signatureText({ html: "<div>Mia <b>M.</b><br>Paris &amp; Lyon</div>" }),
    ).toBe("Mia M.\nParis & Lyon");
    expect(signatureText({ text: "Mia\r\nM." })).toBe("Mia\nM.");
    expect(signatureText({ html: "<div><br></div>" })).toBeNull();
    expect(signatureText(null)).toBeNull();
  });

  test("the body, then the signature under `-- `, then the quote", () => {
    expect(messageText("Hi", null, null)).toBe("Hi");
    expect(messageText("Hi\n\n", "Mia", null)).toBe("Hi\n\n-- \nMia\n");
    expect(messageText("", "Mia", null)).toBe("-- \nMia\n");
    expect(messageText("Hi", "Mia", "> q")).toBe("Hi\n\n-- \nMia\n\n> q\n");
    expect(messageText("Hi", null, "> q")).toBe("Hi\n\n> q\n");
    // Already signed (written in the provider's editor): not again, even
    // when its signature rendered otherwise; a word of it in the body is no
    // signature.
    expect(messageText("Hi\n\n-- \nMia", "Mia", null)).toBe("Hi\n\n-- \nMia");
    expect(messageText("Hi\n-- \nMia\u00a0M.", "Mia M.", null)).toBe(
      "Hi\n-- \nMia\u00a0M.",
    );
    expect(messageText("Thanks Mia", "Mia", null)).toBe(
      "Thanks Mia\n\n-- \nMia\n",
    );
  });
});
