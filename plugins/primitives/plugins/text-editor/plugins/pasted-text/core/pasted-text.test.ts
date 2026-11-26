import { describe, expect, it } from "bun:test";
import {
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
    expect(isLargePaste("a\n".repeat(8))).toBe(false);
    expect(isLargePaste("a\n".repeat(9))).toBe(true);
    expect(isLargePaste("x".repeat(999))).toBe(false);
    expect(isLargePaste("x".repeat(1000))).toBe(true);
    expect(lineCount("a")).toBe(1);
    expect(lineCount("a\nb\n")).toBe(3);
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
