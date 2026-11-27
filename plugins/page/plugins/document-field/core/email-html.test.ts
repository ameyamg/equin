import { describe, expect, it } from "bun:test";
import {
  DOCUMENT_BLOCK_TYPES,
  parseDocument,
  serializeDocument,
} from "./dialect";
import type { DocumentDialect } from "./dialect";
import { EMAIL_TEXT_COLORS, forestToEmailHtml } from "./email";
import { emailHtmlToForest, nearestColorToken } from "./email-html";

const MAIL: DocumentDialect = {
  blocks: DOCUMENT_BLOCK_TYPES,
  blankLines: "empty-block",
  emptyBlocks: "blank-line",
  softBreaks: "newline",
};

/** HTML read back as Mail's markdown. */
const read = (html: string) => serializeDocument(emailHtmlToForest(html), MAIL);

describe("emailHtmlToForest", () => {
  it("reads back what forestToEmailHtml writes", () => {
    const doc = [
      "Hi,",
      "",
      'a **b** _c_ <u>u</u> ~~s~~ `k` [l](https://x.example) <color value="red">r</color>',
      "# H1",
      "## H2",
      "### H3",
      "* one",
      "  * nested",
      "* two",
      "1. first",
      "1. second",
      "---",
      "```",
      "x < 1 && y",
      "  indented",
      "```",
      "<quote>",
      "  quoted **bold**",
      "",
      "  second",
      "</quote>",
      "Bye",
    ].join("\n");
    const forest = parseDocument(doc, MAIL);
    expect(read(forestToEmailHtml(forest))).toBe(
      serializeDocument(forest, MAIL),
    );
  });

  it("reads Gmail's own HTML: a div per line, a div with a br a blank line", () => {
    expect(
      read(
        '<div dir="ltr"><div>Hello <b>there</b>,</div><div><br></div><div>See <a href="https://x.example">this</a>.</div></div>',
      ),
    ).toBe("Hello **there**,\n\nSee [this](https://x.example).");
  });

  it("sets plain <p>s off by a blank line, and collapses whitespace", () => {
    expect(read("<p>One\n   two</p>\n<p>Three</p>")).toBe("One two\n\nThree");
  });

  it("reads styled spans as marks and colours", () => {
    expect(
      read(
        '<span style="font-weight:700">B</span> <span style="font-style:italic">I</span> <span style="color:#d00">R</span> <span style="color:#222">dark</span> <font color="#1a73e8">blue</font>',
      ),
    ).toBe(
      '**B** *I* <color value="red">R</color> dark <color value="blue">blue</color>',
    );
  });

  it("leaves out what a client does not draw, and links that are not web or mail", () => {
    expect(
      read(
        '<html><head><style>p{color:red}</style><title>T</title></head><body><div style="display:none">preheader</div><img src="x.png" alt="logo"><p>Text <a href="javascript:alert(1)">x</a></p><!-- c --></body></html>',
      ),
    ).toBe("Text x");
  });

  it("reads a table's cells as lines and Gmail's quote as a quote", () => {
    expect(
      read(
        '<table><tr><td>A</td><td>B</td></tr></table><div class="gmail_quote"><div>On Mon, X wrote:</div><blockquote class="gmail_quote" style="margin:0 0 0 .8ex">old <i>text</i></blockquote></div>',
      ),
    ).toBe("A\nB\nOn Mon, X wrote:\n<quote>\n  old *text*\n</quote>");
  });

  it("nests a list written straight inside its parent list (Gmail)", () => {
    expect(
      read("<ul><li>one</li><ul><li>two</li></ul><li>three</li></ul>"),
    ).toBe("* one\n  * two\n* three");
  });

  it("reads margins set by the message's own sheet (Outlook)", () => {
    expect(
      read(
        "<head><style>/* x */ p.MsoNormal, li.MsoNormal {margin:0cm; font-size:11pt}</style></head><p class=MsoNormal>Hi,</p><p class=MsoNormal>&nbsp;</p><p class=MsoNormal>Line one</p><p class=MsoNormal>Line two</p>",
      ),
    ).toBe("Hi,\n\nLine one\nLine two");
  });

  it("reads named colours, and inherit keeps the colour around it", () => {
    expect(
      read(
        '<font color="red">a</font> <span style="color:#d00">b<span style="color:inherit">c</span></span>',
      ),
    ).toBe('<color value="red">a</color> <color value="red">bc</color>');
  });

  it("reads thousands of unclosed tags as their text", () => {
    expect(read(`${"<div><span>".repeat(10_000)}deep`)).toBe("deep");
  });

  it("escapes literal markdown characters", () => {
    expect(read("<div>5 * 3 = **15**</div>")).toBe("5 \\* 3 = \\*\\*15\\*\\*");
  });
});

describe("nearestColorToken", () => {
  it("snaps to a token, keeps text colours default", () => {
    for (const [token, hex] of Object.entries(EMAIL_TEXT_COLORS))
      expect<string>(nearestColorToken(hex)).toBe(token);
    expect(nearestColorToken("rgb(0, 128, 0)")).toBe("green");
    expect(nearestColorToken("#d00")).toBe("red");
    expect(nearestColorToken("#1a73e8")).toBe("blue");
    expect(nearestColorToken("#888")).toBe("gray");
    expect(nearestColorToken("#000")).toBe("default");
    expect(nearestColorToken("#222")).toBe("default");
    expect(nearestColorToken("currentColor")).toBe("default");
  });
});
