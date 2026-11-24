// The hand-off contract both sides read: which ops an agent's Bash call runs
// off the call (the guard exports the call's deadline for them), which of those
// may run in the foreground, and how the deadline is derived from the call's
// time limit (the CLI hands the op off at it).
export {
  callDeadline,
  FOREGROUND_OPS,
  HANDOFF_OPS,
  isCallLimitSignal,
  isForegroundOp,
  isHandoffOp,
} from "./internal/handoff-ops";
export type { HandoffOp } from "./internal/handoff-ops";
