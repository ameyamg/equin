import { expect, test } from "bun:test";
import { assertPortableEre, NonPortableGrepPatternError } from "./portable-ere";

test("escaped punctuation and POSIX classes are portable", () => {
  for (const ok of [
    "new WebSocket\\(",
    "a\\.b|c\\[d\\]",
    "[[:space:]]+as[[:space:]]",
    "(^|[^A-Za-z0-9_])data as [A-Z]",
    "\\\\b", // an escaped backslash, then a literal b
    "x\\/y\\{2\\}",
  ])
    expect(() => assertPortableEre(ok)).not.toThrow();
});

test("GNU escapes are refused, naming the escape", () => {
  for (const [bad, esc] of [
    ["\\bdata\\b", "\\b"],
    ["foo\\s+bar", "\\s"],
    ["\\w+", "\\w"],
    ["\\<word\\>", "\\<"],
    ["[0-9]\\d", "\\d"],
    ["a\\\\\\B", "\\B"],
    ["(a)\\1", "\\1"],
    ["trailing\\", "\\ (trailing)"],
  ] as const) {
    let thrown: unknown;
    try {
      assertPortableEre(bad);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(NonPortableGrepPatternError);
    expect((thrown as NonPortableGrepPatternError).escape).toBe(esc);
  }
});
