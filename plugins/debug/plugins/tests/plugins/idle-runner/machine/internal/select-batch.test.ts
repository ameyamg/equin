import { describe, expect, test } from "bun:test";
import {
  IDLE_BATCH_BUDGET_MS,
  IDLE_BATCH_MAX_FILES,
  REVERIFY_AFTER_MS,
  selectIdleBatch,
  type BatchCandidate,
} from "./select-batch";

const NOW = Date.parse("2026-11-11T10:00:00Z");
const DAY = 24 * 60 * 60_000;

function c(
  path: string,
  status: BatchCandidate["status"],
  opts: Partial<Omit<BatchCandidate, "path" | "status">> = {},
): BatchCandidate {
  const never = status === "never";
  return {
    path,
    digest: "d",
    status,
    lastOutcome: never ? null : "passed",
    lastRanAt: never ? null : new Date(NOW - DAY),
    durationMs: never ? null : 1_000,
    currentPassed: status === "passing" ? 1 : 0,
    currentFailed: status === "failing" ? 2 : 0,
    ownPassed: status === "passing" ? 1 : 0,
    ownFailed: status === "failing" ? 2 : 0,
    ...opts,
  };
}

const busy = { idle: false };
const idle = { idle: true };

describe("selectIdleBatch", () => {
  test("due order: to confirm, seen failing elsewhere, stale-and-failing, never run, stale", () => {
    const batch = selectIdleBatch(
      [
        c("stale.test.ts", "stale"),
        c("never.test.ts", "never"),
        c("stale-failed.test.ts", "stale", { lastOutcome: "failed" }),
        c("elsewhere.test.ts", "failing", { ownFailed: 0, currentFailed: 1 }),
        c("once.test.ts", "failing", { ownFailed: 1, currentFailed: 1 }),
        c("confirmed.test.ts", "failing"),
        c("passing.test.ts", "passing"),
      ],
      NOW,
      busy,
    );
    expect(batch).toEqual({
      pool: "due",
      paths: [
        "once.test.ts",
        "elsewhere.test.ts",
        "stale-failed.test.ts",
        "never.test.ts",
        "stale.test.ts",
      ],
    });
  });

  test("a failure already confirmed by main, or a flaky file, is not due again on the same code", () => {
    expect(
      selectIdleBatch(
        [
          c("confirmed.test.ts", "failing"),
          c("flaky.test.ts", "flaky", {
            currentPassed: 1,
            currentFailed: 1,
            ownFailed: 1,
          }),
        ],
        NOW,
        busy,
      ),
    ).toBeNull();
  });

  test("the sweep runs only while idle and nothing is due — failing files included, only past the re-verify age", () => {
    const old = new Date(NOW - REVERIFY_AFTER_MS - DAY);
    const rows = [
      c("old-pass.test.ts", "passing", { lastRanAt: old }),
      c("recent-fail.test.ts", "failing"),
      c("old-fail.test.ts", "failing", { lastRanAt: old }),
    ];
    expect(selectIdleBatch(rows, NOW, busy)).toBeNull();
    expect(selectIdleBatch(rows, NOW, idle)).toEqual({
      pool: "sweep",
      paths: ["old-fail.test.ts", "old-pass.test.ts"],
    });
  });

  test("a batch stops at the file cap or the duration budget, taking the first file whole", () => {
    const many = Array.from({ length: IDLE_BATCH_MAX_FILES + 5 }, (_, i) =>
      c(`n${String(i).padStart(2, "0")}.test.ts`, "never"),
    );
    expect(selectIdleBatch(many, NOW, busy)?.paths).toHaveLength(
      IDLE_BATCH_MAX_FILES,
    );
    const slow = [
      c("huge.test.ts", "stale", { durationMs: IDLE_BATCH_BUDGET_MS * 2 }),
      c("small.test.ts", "stale", {
        durationMs: 1,
        lastRanAt: new Date(NOW),
      }),
    ];
    expect(selectIdleBatch(slow, NOW, busy)?.paths).toEqual(["huge.test.ts"]);
  });
});
