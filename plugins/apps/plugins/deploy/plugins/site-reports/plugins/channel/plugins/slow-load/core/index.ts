export {
  CONNECTION_TYPES,
  judgeHiddenLoad,
  judgeLoad,
  judgeReadyLoad,
  SLOW_LOAD_PHASES,
  SLOW_PAGE_LOAD_BAR_MS,
  SLOW_PAGE_LOAD_KIND,
  slowPageLoadFingerprint,
  SlowPageLoadPayloadSchema,
  slowPageLoadSummary,
  withLoadSplit,
} from "./internal/slow-load";
export { buildLoadSplit } from "./internal/load-split";
export type { LoadSplit } from "./internal/load-split";
export type {
  LoadMilestones,
  LoadVerdict,
  SlowLoadPhase,
  SlowPageLoadPayload,
} from "./internal/slow-load";
