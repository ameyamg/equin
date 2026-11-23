// Shared CLI machinery, not a command (no default export): main's
// `test-failing` reports by test file, for `./equin test` and the push gate.
export { readKnownTestReports } from "./internal/known-reports";
export type { KnownTestReport } from "./internal/known-reports";
