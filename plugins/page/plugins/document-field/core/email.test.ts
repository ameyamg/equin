import { describe, expect, it } from "bun:test";
import {
  DOCUMENT_BLOCK_TYPES,
  parseDocument,
  serializeDocument,
} from "./dialect";
import type { DocumentDialect } from "./dialect";
import { forestToEmailHtml, forestToEmailText, plainTextForest } from "./email";

const MAIL: DocumentDialect = {
  blocks: DOCUMENT_BLOCK_TYPES,
  blankLines: "empty-block",
  emptyBlocks: "blank-line",
  softBreaks: "newline",
};

const html = (src: string) => forestToEmailHtml(parseDocument(src, MAIL));
const text = (src: string) => forestToEmailText(parseDocument(src, MAIL));

describe("forestToEmailHtml", () => {
  it("writes every mark", () => {
    expect(
      html(
        'a **b** _c_ <u>u</u> ~~s~~ `k` [l](https://x.example) <color value="red">r</color>',
      ),
    ).toBe(
      '<p style="margin:0;white-space:pre-wrap">a <b>b</b> <i>c</i> <u>u</u> <s>s</s> <code>k</code> <a href="https://x.example">l</a> <span style="color:#d44c47">r</span></p>',
    );
  });

  it("nests marks two runs share", () => {
    expect(html("**a _b_**")).toBe(
      '<p style="margin:0;white-space:pre-wrap"><b>a <i>b</i></b></p>',
    );
  });

  it("writes every block", () => {
    expect(
      html(
        [
          "# H1",
          "## H2",
          "### H3",
          "",
          "* one",
          "  * nested",
          "* two",
          "1. first",
          "1. second",
          "---",
          "```",
          "x < 1 && y",
          "```",
          "<quote>",
          "  quoted",
          "</quote>",
        ].join("\n"),
      ),
    ).toBe(
      [
        '<h1 style="margin:0">H1</h1>',
        '<h2 style="margin:0">H2</h2>',
        '<h3 style="margin:0">H3</h3>',
        '<p style="margin:0;white-space:pre-wrap"><br></p>',
        '<ul style="margin:0"><li>one<ul style="margin:0"><li>nested</li></ul></li><li>two</li></ul>',
        '<ol style="margin:0"><li>first</li><li>second</li></ol>',
        "<hr>",
        '<pre style="margin:0"><code>x &lt; 1 &amp;&amp; y</code></pre>',
        '<blockquote style="margin:0 0 0 0.8ex;border-left:1px solid #ccc;padding-left:1ex"><p style="margin:0;white-space:pre-wrap">quoted</p></blockquote>',
      ].join(""),
    );
  });

  it("escapes text and refuses links that are not web or mail addresses", () => {
    expect(html("\\<b> & [x](javascript:void)")).toBe(
      '<p style="margin:0;white-space:pre-wrap">&lt;b&gt; &amp; x</p>',
    );
  });

  it("reads a one-line quote", () => {
    expect(html("<quote>one</quote>")).toBe(
      '<blockquote style="margin:0 0 0 0.8ex;border-left:1px solid #ccc;padding-left:1ex"><p style="margin:0;white-space:pre-wrap">one</p></blockquote>',
    );
  });
});

describe("forestToEmailText", () => {
  it("keeps markdown marks and drops the tags", () => {
    expect(
      text(
        'a **b** _c_ <u>u</u> ~~s~~ `k` [l](https://x.example) <color value="red">r</color> [https://y.example](https://y.example)',
      ),
    ).toBe(
      "a **b** _c_ u ~~s~~ `k` [l](https://x.example) r https://y.example",
    );
  });

  it("writes blocks for a person, a quote as > lines, nothing escaped", () => {
    expect(
      text(
        [
          "## Plan",
          "x \\< 1 \\* 2",
          "",
          "- one",
          "  - nested",
          "1. a",
          "1. b",
          "<quote>",
          "  q1",
          "",
          "  q2",
          "</quote>",
          "```",
          "code",
          "```",
          "---",
        ].join("\n"),
      ),
    ).toBe(
      [
        "## Plan",
        "x < 1 * 2",
        "",
        "* one",
        "  * nested",
        "1. a",
        "2. b",
        "> q1",
        ">",
        "> q2",
        "```",
        "code",
        "```",
        "---",
      ].join("\n"),
    );
  });
});

describe("plainTextForest", () => {
  it("reads plain text as literal paragraphs, which round-trip through the dialect", () => {
    const plain =
      "Price: 5 * 3\n# not a heading\n\n---------- Forwarded message ---------\n<b>x</b>\n    indented code\n\t* tabbed\n  - spaced bullet\n   ";
    const written = serializeDocument(plainTextForest(plain), MAIL);
    expect(text(written)).toBe(plain);
  });
});
