import { describe, expect, it } from "bun:test";
import {
  PASTED_TEXT_RE,
  isLargePaste,
  lineCount,
  pastedTextKind,
  splitPastedText,
  wrapPastedText,
} from "./pasted-text";

describe("pasted text", () => {
  it("splits a message around its blocks", () => {
    const msg = `look:\n${wrapPastedText("a\nb")}\nand ${wrapPastedText("c")} done`;
    expect(splitPastedText(msg)).toEqual([
      { kind: "text", text: "look:\n" },
      { kind: "pasted", body: "a\nb" },
      { kind: "text", text: "\nand " },
      { kind: "pasted", body: "c" },
      { kind: "text", text: " done" },
    ]);
    expect(splitPastedText("plain")).toEqual([{ kind: "text", text: "plain" }]);
  });

  it("round-trips an empty body", () => {
    expect(splitPastedText(wrapPastedText(""))).toEqual([
      { kind: "pasted", body: "" },
    ]);
  });

  it("writes any body as one block and reads it back exactly", () => {
    for (const body of [
      "a </pasted_content> b",
      'x\n</pasted_content id="e112">\ny',
      "<\\/pasted_content and <\\\\/pasted_content",
      "plain",
    ]) {
      const msg = `before\n${wrapPastedText(body)}\nafter`;
      expect(splitPastedText(msg)).toEqual([
        { kind: "text", text: "before\n" },
        { kind: "pasted", body },
        { kind: "text", text: "\nafter" },
      ]);
      // Nothing inside can close the block, or match Claude Code's own close.
      expect(msg.match(/<\/pasted_content/g)).toHaveLength(1);
    }
  });

  it("calls a paste large by lines or by length", () => {
    expect(isLargePaste("a\n".repeat(8), [])).toBe(false);
    expect(isLargePaste("a\n".repeat(9), [])).toBe(true);
    expect(isLargePaste("x".repeat(999), [])).toBe(false);
    expect(isLargePaste("x".repeat(1000), [])).toBe(true);
    expect(lineCount("a")).toBe(1);
    expect(lineCount("a\nb\n")).toBe(3);
  });

  it("measures a paste as drawn: a token weighs one character", () => {
    // A per-line chip family shaped like `<ui-context …>…</ui-context>`.
    const chip = {
      pattern: /<chip [^>]*>[^<]*<\/chip>/,
      node: { fieldsOf: () => ({}) },
      spansLines: false,
    };
    // A spanning family: a pasted block, whose newlines are inside the token.
    const block = {
      pattern: PASTED_TEXT_RE,
      node: { fieldsOf: () => ({}) },
      spansLines: true,
    };
    const tag = `<chip a="${"x".repeat(900)}">label</chip>`;
    const chips = `see ${tag} and ${tag} and ${tag}`;
    expect(isLargePaste(chips, [])).toBe(true);
    expect(isLargePaste(chips, [chip])).toBe(false);
    // The text around the chips still counts.
    expect(isLargePaste(`${"y".repeat(1000)} ${tag}`, [chip])).toBe(true);
    const nested = wrapPastedText("l\n".repeat(20));
    expect(isLargePaste(nested, [])).toBe(true);
    expect(isLargePaste(nested, [block])).toBe(false);
  });

  it("names what was pasted", () => {
    expect(pastedTextKind('{"a": [1, 2]}')).toBe("json");
    expect(pastedTextKind("{ not json")).toBe("text");
    expect(pastedTextKind("import x from 'y';\nconst a = 1;")).toBe("code");
    expect(pastedTextKind("13:42:01 ERROR backend failed")).toBe("log");
    expect(pastedTextKind("Error: boom\n    at f (a.ts:3:4)")).toBe("log");
    expect(pastedTextKind("Dear team,\nthanks.")).toBe("text");
  });
});
