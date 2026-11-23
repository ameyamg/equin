import { describe, expect, test } from "bun:test";
import type { TestRunRecord } from "@plugins/framework/plugins/cli/plugins/test/plugins/record/core";
import { affectedTests, isProvingPass, judgeFailure } from "./judge";
import { buildVerdictIndex } from "./verdicts";

const MAIN = "main-ns";

function record(opts: {
  opId: string;
  slug?: string;
  startedAt: string;
  files: Array<{
    path: string;
    digest: string;
    outcome: "passed" | "failed" | "not-loaded";
    cases?: number;
    failed?: string[];
  }>;
}): TestRunRecord {
  return {
    v: 1,
    opId: opts.opId,
    repo: "/r",
    slug: opts.slug ?? "att-x",
    origin: "agent",
    head: null,
    treeHash: "t",
    startedAt: opts.startedAt,
    finishedAt: opts.startedAt,
    digestVersion: "d",
    runners: [],
    files: opts.files.map((f) => ({
      path: f.path,
      runner: "bun:test",
      digest: f.digest,
      outcome: f.outcome,
      cases: f.cases ?? 3,
      failedCases: f.failed?.length ?? 0,
      durationMs: 100,
    })),
    failures: opts.files.flatMap((f) =>
      (f.failed ?? []).map((caseId) => ({
        path: f.path,
        caseId,
        message: "",
        detail: "",
      })),
    ),
  };
}

describe("affectedTests", () => {
  test("a moved digest or a new file is affected; an unchanged or deleted one is not", () => {
    const head = new Map([
      ["a.test.ts", "1"],
      ["b.test.ts", "2"],
      ["new.test.ts", "3"],
    ]);
    const base = new Map([
      ["a.test.ts", "1"],
      ["b.test.ts", "old"],
      ["gone.test.ts", "4"],
    ]);
    expect(affectedTests(head, base)).toEqual(["b.test.ts", "new.test.ts"]);
  });
});

describe("isProvingPass", () => {
  test("a pass with no case run proves nothing", () => {
    const idx = buildVerdictIndex(
      [
        record({
          opId: "1",
          startedAt: "2026-11-20T00:00:00Z",
          files: [{ path: "f", digest: "d", outcome: "passed", cases: 0 }],
        }),
      ],
      MAIN,
    );
    expect(isProvingPass(idx.at("f", "d")[0]!)).toBe(false);
  });
});

describe("judgeFailure", () => {
  const T = (n: number) => `2026-11-2${n}T00:00:00Z`;

  test("a test that does not exist at the merge base is new", () => {
    const idx = buildVerdictIndex([], MAIN);
    expect(judgeFailure("f", undefined, [], idx)).toMatchObject({
      kind: "new",
      reason: "new-file",
    });
  });

  test("failing at the base digest is pre-existing, naming cases the base never saw fail", () => {
    const idx = buildVerdictIndex(
      [
        record({
          opId: "1",
          startedAt: T(1),
          files: [
            { path: "f", digest: "B", outcome: "failed", failed: ["s > a"] },
          ],
        }),
      ],
      MAIN,
    );
    expect(judgeFailure("f", "B", ["s > a", "s > b"], idx)).toMatchObject({
      kind: "pre-existing",
      reason: "failed-at-base",
      newCases: ["s > b"],
    });
  });

  test("passing at the base digest is new — by majority, not by the newest run", () => {
    const idx = buildVerdictIndex(
      [
        record({
          opId: "1",
          startedAt: T(1),
          files: [{ path: "f", digest: "B", outcome: "passed" }],
        }),
        record({
          opId: "2",
          startedAt: T(2),
          files: [{ path: "f", digest: "B", outcome: "passed" }],
        }),
        record({
          opId: "3",
          startedAt: T(3),
          files: [{ path: "f", digest: "B", outcome: "failed" }],
        }),
      ],
      MAIN,
    );
    expect(judgeFailure("f", "B", [], idx)).toMatchObject({
      kind: "new",
      reason: "passed-at-base",
    });
  });

  test("a not-loaded verdict at the base is no evidence of failing", () => {
    const idx = buildVerdictIndex(
      [
        record({
          opId: "1",
          startedAt: T(1),
          files: [{ path: "f", digest: "B", outcome: "not-loaded" }],
        }),
      ],
      MAIN,
    );
    expect(judgeFailure("f", "B", [], idx)).toMatchObject({
      kind: "new",
      reason: "no-evidence",
    });
  });

  test("no verdict at the base: main's own newest run decides", () => {
    const failingOnMain = buildVerdictIndex(
      [
        record({
          opId: "1",
          slug: MAIN,
          startedAt: T(1),
          files: [{ path: "f", digest: "X", outcome: "passed" }],
        }),
        record({
          opId: "2",
          slug: MAIN,
          startedAt: T(2),
          files: [{ path: "f", digest: "Y", outcome: "failed" }],
        }),
        // Another checkout's verdict at another digest says nothing about main.
        record({
          opId: "3",
          startedAt: T(3),
          files: [{ path: "f", digest: "Z", outcome: "passed" }],
        }),
      ],
      MAIN,
    );
    expect(judgeFailure("f", "B", [], failingOnMain)).toMatchObject({
      kind: "pre-existing",
      reason: "failing-on-main",
    });
    const passingOnMain = buildVerdictIndex(
      [
        record({
          opId: "1",
          slug: MAIN,
          startedAt: T(2),
          files: [{ path: "f", digest: "X", outcome: "passed" }],
        }),
        record({
          opId: "2",
          slug: MAIN,
          startedAt: T(1),
          files: [{ path: "f", digest: "Y", outcome: "failed" }],
        }),
      ],
      MAIN,
    );
    expect(judgeFailure("f", "B", [], passingOnMain)).toMatchObject({
      kind: "new",
      reason: "passing-on-main",
    });
  });
});
