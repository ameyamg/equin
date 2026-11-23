export {
  affectedTests,
  describeJudgement,
  isProvingPass,
  judgeFailure,
} from "./internal/judge";
export type { FailureJudgement } from "./internal/judge";
export { buildVerdictIndex } from "./internal/verdicts";
export type { RecordedVerdict, VerdictIndex } from "./internal/verdicts";
