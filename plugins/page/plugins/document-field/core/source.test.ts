import { describe, expect, test } from "bun:test";
import type { SerializedBlock } from "@plugins/page/plugins/editor/core";
import {
  DOCUMENT_BLOCK_TYPES,
  documentBlockHandle,
  parseDocument,
  serializeDocument,
  type DocumentDialect,
} from "./dialect";
import { lineSegments, sourceLines } from "./source";
import { applySourceFormat, sourceFormatState } from "./source-format";
import { blockPointOf, sourceOffsetOf } from "./source-points";

const MAIL: DocumentDialect = {
  blocks: DOCUMENT_BLOCK_TYPES,
  blankLines: "empty-block",
  emptyBlocks: "blank-line",
  softBreaks: "newline",
};

const BODY = [
  "Hi Maya,",
  "",
  "Agreed on moving the marketplace to **Q2**. Before Tuesday, could you:",
  "* name an owner for [plugin signing](https://docs.example.com/plugin-signing)",
  "* say *plainly* what slips, and <u>why</u>",
  "  * nested ~~one~~",
  "1. first `code`",
  "2. second",
  "# A heading",
  "### Small one",
  "---",
  "```ts",
  "const x = 1;",
  "",
  "```",
  "<quote>",
  '  Can we ship before the <color value="red">freeze</color>?',
  "",
  "  Second paragraph",
  "</quote>",
  "\\# not a heading",
].join("\n");

/** The leaf blocks of a forest, in document order — never a container. */
function leaves(forest: SerializedBlock[]): SerializedBlock[] {
  return forest.flatMap((b) =>
    documentBlockHandle(b.type as "text").anchor
      ? leaves(b.children)
      : [b, ...leaves(b.children)],
  );
}

describe("the dialect", () => {
  test("a Mail body round-trips through the forest", () => {
    const forest = parseDocument(BODY, MAIL);
    expect(serializeDocument(forest, MAIL)).toBe(BODY);
    expect(forest.map((b) => b.type)).toEqual([
      "text",
      "text",
      "text",
      "bulleted-list",
      "bulleted-list",
      "numbered-list",
      "numbered-list",
      "heading-1",
      "heading-3",
      "divider",
      "code-block",
      "quote",
      "text",
    ]);
  });

  test("a dialect without paragraphs is refused", () => {
    expect(() =>
      parseDocument("x", { ...MAIL, blocks: ["heading-1"] }),
    ).toThrow(/"text" must be among its blocks/);
  });
});

describe("sourceLines", () => {
  test("every text line's inline part parses to its block's text", () => {
    const lines = sourceLines(BODY, MAIL);
    const blocks = leaves(parseDocument(BODY, MAIL));
    for (const line of lines) {
      if (line.kind !== "text") continue;
      const block = blocks[line.block!]!;
      expect(line.scan!.runs).toEqual(
        (block.data as { text: unknown }).text as never,
      );
    }
  });

  test("lines are numbered by the parser's leaf blocks", () => {
    const lines = sourceLines(BODY, MAIL);
    const blocks = leaves(parseDocument(BODY, MAIL));
    const numbered = new Set(
      lines.flatMap((l) => (l.block === null ? [] : [l.block])),
    );
    expect(numbered.size).toBe(blocks.length);
    expect(Math.max(...numbered)).toBe(blocks.length - 1);
    // The quote's tag lines own no block; a fence's lines share one.
    const byText = (t: string) =>
      lines.find((l) => BODY.slice(l.start, l.end) === t)!;
    expect(byText("<quote>").block).toBeNull();
    expect(byText("</quote>").block).toBeNull();
    expect(byText("const x = 1;").block).toBe(byText("```ts").block);
    expect(blocks[byText("```ts").block!]!.type).toBe("code-block");
  });

  test("prefixes are read off the parse, escapes included", () => {
    const lines = sourceLines(BODY, MAIL);
    const prefix = (t: string) => {
      const l = lines.find((l) => BODY.slice(l.start, l.end) === t)!;
      return BODY.slice(l.start, l.contentStart);
    };
    expect(prefix("# A heading")).toBe("# ");
    expect(prefix("  * nested ~~one~~")).toBe("  * ");
    expect(prefix("2. second")).toBe("2. ");
    expect(prefix("\\# not a heading")).toBe("\\");
    expect(prefix("Hi Maya,")).toBe("");
  });

  test("blank lines first or last in a scope own no block", () => {
    const lines = sourceLines("\nA\n\nB\n<quote>\n\n  C\n\n</quote>\n", MAIL);
    expect(lines.map((l) => l.block)).toEqual([
      null,
      0,
      1,
      2,
      null,
      null,
      3,
      null,
      null,
      null,
    ]);
    expect(
      leaves(parseDocument("\nA\n\nB\n<quote>\n\n  C\n\n</quote>\n", MAIL)),
    ).toHaveLength(4);
  });

  test("segments split a line into syntax and looks", () => {
    const value = "* say _plainly_ and <u>why</u>";
    const [line] = sourceLines(value, MAIL);
    const segs = lineSegments(line!).map((s) => ({
      text: value.slice(s.start, s.end),
      syntax: s.syntax,
      marks: s.marks,
    }));
    expect(segs).toEqual([
      { text: "* ", syntax: true, marks: [] },
      { text: "say ", syntax: false, marks: [] },
      { text: "_", syntax: true, marks: [] },
      { text: "plainly", syntax: false, marks: ["italic"] },
      { text: "_", syntax: true, marks: [] },
      { text: " and ", syntax: false, marks: [] },
      { text: "<u>", syntax: true, marks: [] },
      { text: "why", syntax: false, marks: ["underline"] },
      { text: "</u>", syntax: true, marks: [] },
    ]);
  });
});

describe("applySourceFormat", () => {
  const apply = (
    value: string,
    start: number,
    end: number,
    f: Parameters<typeof applySourceFormat>[2],
  ) => applySourceFormat(value, { start, end }, f, MAIL);

  test("bold wraps the selection, and the range stays on its words", () => {
    const r = apply("say plainly", 4, 11, { kind: "mark", mark: "bold" });
    expect(r.value).toBe("say **plainly**");
    expect(r.value.slice(r.range.start, r.range.end)).toBe("plainly");
  });

  test("toggling a mark that covers the selection removes it", () => {
    const r = apply("say **plainly**", 6, 13, { kind: "mark", mark: "bold" });
    expect(r.value).toBe("say plainly");
    expect(r.value.slice(r.range.start, r.range.end)).toBe("plainly");
  });

  test("underline and colour are written as Pages' tags", () => {
    expect(apply("why", 0, 3, { kind: "mark", mark: "underline" }).value).toBe(
      "<u>why</u>",
    );
    expect(apply("late", 0, 4, { kind: "color", color: "red" }).value).toBe(
      '<color value="red">late</color>',
    );
    expect(
      apply('<color value="red">late</color>', 19, 23, {
        kind: "color",
        color: "default",
      }).value,
    ).toBe("late");
  });

  test("links are written and removed", () => {
    const linked = apply("see docs", 4, 8, {
      kind: "link",
      href: "https://x.dev",
    });
    expect(linked.value).toBe("see [docs](https://x.dev)");
    expect(apply(linked.value, 5, 9, { kind: "link", href: null }).value).toBe(
      "see docs",
    );
  });

  test("a range across lines formats each line's text and leaves prefixes alone", () => {
    const value = "# Title\n* one\n* two";
    const r = apply(value, 2, value.length, { kind: "mark", mark: "italic" });
    expect(r.value).toBe("# *Title*\n* *one*\n* *two*");
    expect(r.value.slice(r.range.start, r.range.end)).toBe(
      "Title*\n* *one*\n* *two",
    );
  });

  test("code lines and tag lines are not formatted", () => {
    const value = "```\ncode\n```";
    expect(
      apply(value, 0, value.length, { kind: "mark", mark: "bold" }).value,
    ).toBe(value);
  });

  test("the state reads what covers the selection", () => {
    const value = "say **_plainly_** [x](https://a.b)";
    const s = sourceFormatState(value, { start: 7, end: 14 }, MAIL);
    expect(s.active.bold).toBe(true);
    expect(s.active.italic).toBe(true);
    expect(s.active.code).toBe(false);
    expect(sourceFormatState(value, { start: 19, end: 20 }, MAIL).link).toBe(
      "https://a.b",
    );
    expect(
      sourceFormatState(value, { start: 0, end: 3 }, MAIL).active.bold,
    ).toBe(false);
  });
});

describe("block points", () => {
  test("a point survives source → block → source", () => {
    const lines = sourceLines(BODY, MAIL);
    for (const at of [
      0,
      3,
      12,
      50,
      60,
      120,
      BODY.indexOf("const"),
      BODY.indexOf("Second"),
    ]) {
      const point = blockPointOf(lines, at);
      const back = sourceOffsetOf(lines, point);
      expect(blockPointOf(lines, back)).toEqual(point);
    }
  });

  test("an offset in a line's text lands past its syntax", () => {
    const value = "* say **bold**";
    const lines = sourceLines(value, MAIL);
    // "say b" is 5 characters of text: the caret lands after the `b`.
    expect(value.slice(0, sourceOffsetOf(lines, { block: 0, offset: 5 }))).toBe(
      "* say **b",
    );
    expect(blockPointOf(lines, value.indexOf("old"))).toEqual({
      block: 0,
      offset: 5,
    });
  });

  test("a fence's offset is in its code", () => {
    const value = "```\nab\ncd\n```";
    const lines = sourceLines(value, MAIL);
    expect(sourceOffsetOf(lines, { block: 0, offset: 4 })).toBe(
      value.indexOf("d"),
    );
    expect(blockPointOf(lines, value.indexOf("c"))).toEqual({
      block: 0,
      offset: 3,
    });
  });
});
