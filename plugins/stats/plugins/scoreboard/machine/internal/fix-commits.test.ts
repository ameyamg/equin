import { describe, expect, test } from "bun:test";
import { isGuardPath, parseFixLog } from "./fix-commits";

describe("isGuardPath", () => {
  test("lint rules and checks are guards, their tests are not", () => {
    expect(isGuardPath("src/a/lint/no-foo.ts")).toBe(true);
    expect(isGuardPath("src/a/check/index.ts")).toBe(true);
    expect(isGuardPath("src/a/check/foo.test.ts")).toBe(false);
    expect(isGuardPath("src/a/server/internal/check.ts")).toBe(false);
  });
});

describe("parseFixLog", () => {
  test("one fix per push, a guard when any of its commits added one", () => {
    const out = [
      "@@aaa\t1795000000\tpush-1\t",
      "",
      "src/a/server/a.ts",
      "@@bbb\t1795000100\tpush-1\t",
      "",
      "src/a/lint/rule.ts",
      "@@ccc\t1795000200\t\t",
      "",
      "src/b/web/b.tsx",
    ].join("\n");
    const fixes = parseFixLog(out);
    expect(fixes).toHaveLength(2);
    expect(fixes[0]).toEqual({ at: 1795000100_000, level: null, guard: true });
    expect(fixes[1]).toEqual({ at: 1795000200_000, level: null, guard: false });
  });

  test("reads the push's declared level", () => {
    const out = [
      "@@aaa\t1795000000\tpush-1\tdesigned-away",
      "",
      "src/a/server/a.ts",
      "@@bbb\t1795000100\tpush-2\tone-off",
    ].join("\n");
    expect(parseFixLog(out)).toEqual([
      { at: 1795000000_000, level: "designed-away", guard: false },
      { at: 1795000100_000, level: "one-off", guard: false },
    ]);
  });

  test("throws on a level outside the closed set", () => {
    expect(() => parseFixLog("@@aaa\t1795000000\tpush-1\tlint")).toThrow(
      /not a fix level/,
    );
  });
});
