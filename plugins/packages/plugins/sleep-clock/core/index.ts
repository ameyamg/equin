// `core/` here means RUNTIME-NEUTRAL NODE, not web-safe: the binding is
// `bun:ffi` (same as packages/flock). Never import it from `web/`.
export {
  clockStampNow,
  createSleepMeter,
  processStartStamp,
  readAwakeClock,
  readSleepClock,
} from "./internal/sleep-clock";
export {
  judgeProcessAwakeAge,
  readProcessAwakeAge,
} from "./internal/process-age";
export type { ProcessAwakeAge } from "./internal/process-age";
export type {
  AwakeClockReading,
  SleepClockReading,
  SleepMeter,
  SleepReading,
} from "./internal/sleep-clock";
