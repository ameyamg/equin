import type { ReportRow } from "@plugins/reports/server";
import {
  shortCommit,
  testFailingMessage,
  type TestFailingPayload,
  type TestRunRef,
} from "../../core";

// The task body, kept apart from the `ReportKind` wiring (kind.ts) so it is
// testable without evaluating the reports plugin's server barrel.

const runLine = (label: string, r: TestRunRef): string =>
  `- ${label}: \`${r.commit ?? "(no commit recorded)"}\` (run \`${r.opId}\`, ${r.at})`;

export function renderTestFailingTask(
  row: ReportRow,
  d: TestFailingPayload,
): { title: string; description: string } {
  const lines: string[] = [
    `Main's test runner (Debug → Tests) saw \`${d.path}\`` +
      (d.pluginId === null ? "" : ` (plugin \`${d.pluginId}\`)`) +
      (d.lastPassed === null
        ? " fail on main's code"
        : " go from passing to failing") +
      ", and a second run on the same code confirmed it — so this is not a single flaky run.",
    "",
    "**Where it started:**",
    d.lastPassed === null
      ? "- last passed on main: no pass on record (broken before the kept results, or never passed on main)"
      : runLine("last passed on main", d.lastPassed),
    runLine("first seen failing on main", d.firstFailed),
    runLine("latest failure", d.latest),
    d.lastPassed === null
      ? `The culprit is at or before \`${shortCommit(d.firstFailed.commit)}\`.`
      : `The culprit is in \`git log ${shortCommit(d.lastPassed.commit)}..${shortCommit(d.firstFailed.commit)}\` ` +
        "(main's checkout tests whatever main is at, so the range can span several pushes).",
    "",
    "**What to do:**",
    `1. Reproduce from a worktree: \`./equin test ${d.path}\`.`,
    "2. Find the change that broke it in the range above, and fix the code or " +
      "the test — whichever is wrong. Never skip or delete the test to make it pass.",
    "3. Push with `--fixes-report <this report's id>`, so a later failure of " +
      "this file on code containing the fix marks the report Regressed.",
    "",
  ];
  if (d.latest.outcome === "not-loaded") {
    lines.push(
      "**The file did not load** in the latest run (an import or setup error " +
        "before any case ran) — see the run's output in Debug → Tests.",
    );
  } else {
    lines.push(
      `**Failing cases (latest run, ${d.failedCaseCount}):**`,
      ...d.failingCases.map((c) => `- \`${c.caseId}\` — ${c.message}`),
    );
    if (d.failedCaseCount > d.failingCases.length)
      lines.push(
        `- …and ${d.failedCaseCount - d.failingCases.length} more (Debug → Tests).`,
      );
  }
  lines.push("");
  lines.push(`**Failures on the current code:** ${d.failuresOnCurrentCode}`);
  lines.push(`**Occurrences:** ${row.count}`);
  lines.push(`**First seen:** ${row.firstSeenAt.toISOString()}`);
  lines.push(`**Last seen:** ${row.lastSeenAt.toISOString()}`);
  return {
    title: `[test-failing] ${testFailingMessage(d)}`,
    description: lines.join("\n"),
  };
}
