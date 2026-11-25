import { describe, expect, test } from "bun:test";
import { FIX_LEVELS } from "@plugins/reports/core";
import { fixLevelTrailer, resolveFixedReports } from "./fixed-reports";

describe("fixLevelTrailer", () => {
  test("a fix push declaring a level stamps it", () => {
    expect(fixLevelTrailer(["report-1"], "refused-before-landing")).toEqual({
      ok: true,
      trailer: "Fix-level=refused-before-landing",
    });
    expect(fixLevelTrailer(["report-1"], " one-off ")).toEqual({
      ok: true,
      trailer: "Fix-level=one-off",
    });
  });

  test("a fix push without a level is refused, naming every level", () => {
    const r = fixLevelTrailer(["report-1"], undefined);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain("--fix-level");
    for (const level of FIX_LEVELS) expect(r.message).toContain(level);
  });

  test("a level outside the closed set is refused", () => {
    const r = fixLevelTrailer(["report-1"], "lint");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('"lint" is not a fix level');
  });

  test("a level on a push naming no fix is refused; neither is fine", () => {
    expect(fixLevelTrailer([], "one-off").ok).toBe(false);
    expect(fixLevelTrailer([], undefined)).toEqual({ ok: true, trailer: null });
  });
});

describe("resolveFixedReports", () => {
  // These refusals come before any git or database read.
  const base = { fixedBy: [], message: undefined, repoRoot: "/nonexistent" };

  test("refuses --fixes-report without --fix-level", async () => {
    const r = await resolveFixedReports({
      ...base,
      ids: ["report-1795000000-abcdef"],
      level: undefined,
    });
    expect(r.ok).toBe(false);
  });

  test("refuses a Fix-level: line typed into -m", async () => {
    const r = await resolveFixedReports({
      ...base,
      ids: [],
      level: undefined,
      message: "fix\n\nFix-level: one-off",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('"Fix-level:"');
  });

  test("a push naming nothing needs no level", async () => {
    expect(
      await resolveFixedReports({ ...base, ids: [], level: undefined }),
    ).toEqual({ ok: true, trailers: [], fixes: [], fixedBy: [] });
  });
});
