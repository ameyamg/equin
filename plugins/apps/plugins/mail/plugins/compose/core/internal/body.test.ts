import { describe, expect, it } from "bun:test";
import {
  asDocumentContent,
  bodyText,
  messageParts,
  plainTextBody,
  quoteBody,
} from "./body";
import { EMPTY_DRAFT_CONTENT, DraftContentSchema, isDraftEmpty } from "./draft";
import { bodySigned } from "./reply";

const QUOTE =
  "On Mon, Maya <maya@example.com> wrote:\n> Can we ship?\n>\n> Thanks";

describe("messageParts", () => {
  const body = [
    "Hi **Maya**,",
    "",
    "* say _plainly_ what slips, and <u>why</u>",
    '* <color value="red">it\'s late</color>',
    "",
    "<quote>",
    "  Before the freeze?",
    "</quote>",
  ].join("\n");

  it("sends a document as HTML beside a text/plain alternative", () => {
    const parts = messageParts(body, "document", null, null);
    expect(parts.text).toBe(
      [
        "Hi **Maya**,",
        "",
        "* say _plainly_ what slips, and why",
        "* it's late",
        "",
        "> Before the freeze?",
      ].join("\n"),
    );
    expect(parts.html).toBe(
      [
        '<p style="margin:0;white-space:pre-wrap">Hi <b>Maya</b>,</p>',
        '<p style="margin:0;white-space:pre-wrap"><br></p>',
        '<ul style="margin:0"><li>say <i>plainly</i> what slips, and <u>why</u></li>',
        `<li><span style="color:#d44c47">it's late</span></li></ul>`,
      ].join("") +
        '<p style="margin:0;white-space:pre-wrap"><br></p><blockquote style="margin:0 0 0 0.8ex;border-left:1px solid #ccc;padding-left:1ex"><p style="margin:0;white-space:pre-wrap">Before the freeze?</p></blockquote>',
    );
  });

  it("adds the signature and the quote to both parts", () => {
    const parts = messageParts("Hi", "document", "Mia\nmia.example", QUOTE);
    expect(parts.text).toBe(`Hi\n\n-- \nMia\nmia.example\n\n${QUOTE}\n`);
    expect(parts.html).toBe(
      '<p style="margin:0;white-space:pre-wrap">Hi</p>' +
        '<p style="margin:0;white-space:pre-wrap"><br></p><div class="gmail_signature">Mia<br>mia.example</div>' +
        '<br><div class="gmail_quote"><p style="margin:0;white-space:pre-wrap">On Mon, Maya &lt;maya@example.com&gt; wrote:</p>' +
        '<blockquote style="margin:0 0 0 0.8ex;border-left:1px solid #ccc;padding-left:1ex">' +
        '<p style="margin:0;white-space:pre-wrap">Can we ship?</p><p style="margin:0;white-space:pre-wrap"><br></p><p style="margin:0;white-space:pre-wrap">Thanks</p></blockquote></div>',
    );
  });

  it("sends a body saved as plain text as text alone, as before", () => {
    expect(messageParts("5 * 3 = **15**", "text", "Mia", null)).toEqual({
      text: "5 * 3 = **15**\n\n-- \nMia\n",
      html: null,
    });
  });

  it("does not sign a body signed already", () => {
    const adopted = plainTextBody("Hi\n\n-- \nMia");
    expect(bodySigned(bodyText(adopted))).toBe(true);
    const parts = messageParts(adopted, "document", "Mia", null);
    expect(parts.text.match(/-- /g)?.length).toBe(1);
    expect(parts.html).not.toContain("gmail_signature");
  });
});

describe("drafts saved before formatting", () => {
  it("read as text, and open as plain paragraphs", () => {
    const old = DraftContentSchema.parse({
      ...EMPTY_DRAFT_CONTENT,
      bodyFormat: undefined,
      body: "5 * 3\n# not a heading\n<b>",
    });
    expect(old.bodyFormat).toBe("text");
    const opened = asDocumentContent(old);
    expect(opened.bodyFormat).toBe("document");
    expect(bodyText(opened.body)).toBe("5 * 3\n# not a heading\n<b>");
  });

  it("count a body of spaces as nothing written", () => {
    expect(
      isDraftEmpty({ ...EMPTY_DRAFT_CONTENT, body: plainTextBody("   ") }),
    ).toBe(true);
    expect(
      isDraftEmpty({ ...EMPTY_DRAFT_CONTENT, body: plainTextBody("  x") }),
    ).toBe(false);
  });

  it("start new drafts as documents", () => {
    expect(EMPTY_DRAFT_CONTENT.bodyFormat).toBe("document");
  });
});

describe("quoteBody", () => {
  it("is the header line, then the original as one quote", () => {
    expect(quoteBody(QUOTE)).toBe(
      [
        "On Mon, Maya \\<maya@example.com> wrote:",
        "<quote>",
        "  Can we ship?",
        "",
        "  Thanks",
        "</quote>",
      ].join("\n"),
    );
  });
});
