import { ReportKind, type ReportRow } from "@plugins/reports/server";
import {
  TEST_FAILING_KIND,
  TestFailingPayloadSchema,
  testFailingFingerprint,
} from "../../core";
import { renderTestFailingTask } from "./render";

/** Distinct broken test files one window may report: every test file of a
 * large plugin breaking at once, still one report each. */
const TEST_FAILING_FAN_OUT = 500;

/**
 * The `test-failing` report kind: one row per test file of main that went
 * from passing to failing (confirmed by a second failing run), filed by main's
 * test runner. Category `test`: the Broken tests supervisor stream announces
 * it to the role that stream is routed to (no task is filed for it), and the
 * fix ledger closes it like every report.
 *
 * Its fan-out ceiling is raised: one push can break many tests at once, and
 * past the default 20 new fingerprints per window the rest would fold into a
 * storm rollup — files with no report of their own.
 */
export const testFailingKind = ReportKind({
  kind: TEST_FAILING_KIND,
  schema: TestFailingPayloadSchema,
  fingerprint: testFailingFingerprint,
  meta: {
    tag: "[test-failing]",
    notif: "A test started failing on main",
    variant: "error",
    category: "test",
    fanOutPerWindow: TEST_FAILING_FAN_OUT,
  },
  renderTask: (row: ReportRow) =>
    renderTestFailingTask(row, TestFailingPayloadSchema.parse(row.data)),
});
