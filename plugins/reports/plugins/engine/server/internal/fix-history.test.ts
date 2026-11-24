import { describe, expect, test } from "bun:test";
import { formatFixHistory, type FixHistoryEntry } from "./fix-history";

const fix = (over: Partial<FixHistoryEntry>): FixHistoryEntry => ({
  commit: "a".repeat(40),
  subject: "perf(x): skip the rescan",
  conversation: "conv-1795000000-abcdef",
  landedAt: new Date("2026-11-20T10:00:00Z"),
  deployedAt: new Date("2026-11-20T10:30:00Z"),
  regressedAt: null,
  regressedCommit: null,
  ...over,
});

describe("formatFixHistory", () => {
  test("a report never fixed has no section", () => {
    expect(formatFixHistory([])).toBeNull();
  });

  test("a fix still holding is listed, with no recurrence instruction", () => {
    const text = formatFixHistory([fix({})])!;
    expect(text).toContain("**Fixed before** (fixed once):");
    expect(text).toContain(
      '`aaaaaaaaaaaa` "perf(x): skip the rescan" (conv-1795000000-abcdef) — landed 2026-11-20 10:00 UTC; live since 2026-11-20 10:30 UTC, holding.',
    );
    expect(text).not.toContain("one level up");
  });

  test("a fix that came back says how long it held, what fired, and asks for the level up", () => {
    const text = formatFixHistory([
      fix({
        regressedAt: new Date("2026-11-21T12:30:00Z"),
        regressedCommit: "b".repeat(40),
      }),
      fix({
        commit: "c".repeat(40),
        conversation: null,
        landedAt: new Date("2026-11-22T09:00:00Z"),
        deployedAt: new Date("2026-11-22T10:00:00Z"),
        regressedAt: new Date("2026-11-22T08:00:00Z"),
        regressedCommit: null,
      }),
    ])!;
    expect(text).toContain("(fixed 2 times, came back 2 times)");
    expect(text).toContain(
      "; held 1d 02h, fired again 2026-11-21 12:30 UTC from code at `bbbbbbbbbbbb`.",
    );
    expect(text).toContain(
      '`cccccccccccc` "perf(x): skip the rescan" — landed 2026-11-22 09:00 UTC; came back before it was live, fired again 2026-11-22 08:00 UTC from code that could not name its commit.',
    );
    expect(text).toContain("explain why it did not hold");
    expect(text).toContain("one level up");
  });
});
