// Shared CLI machinery, not a command (no default export): where a failing
// test file stands on main, for `./equin test` and the push test gate.
export { readTestRunRecords } from "./internal/records";
export {
  mainSlug,
  mergeBaseDigests,
  readVerdictIndex,
  standingLines,
  standingOnMain,
} from "./internal/standing";
export type {
  FailingFile,
  Standing,
  StandingResult,
} from "./internal/standing";
