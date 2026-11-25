import {
  DARK_WAKE_LAYER,
  HIDDEN_LAYER,
  SLEEP_LAYER,
} from "../../shared/endpoints";
import type { RecordSlowOpInput } from "./input";

/**
 * The machine's unattended time, as the funnel reads it: machine-sleep's
 * history in production (`machineUnattended`), injected in tests. Each
 * `null` is "cannot tell" — nothing comes off.
 */
export interface UnattendedClock {
  sleptDuring(startMs: number, endMs: number): number | null;
  darkWakeDuring(startMs: number, endMs: number): number | null;
  awakeSpanStart(endMs: number, awakeMs: number): number | null;
}

/**
 * Take the time no person could have waited off an op's own time: machine
 * sleep and dark wakes, over the op's wall-clock window. The one place every
 * slow-op producer is judged on attended time — the funnel calls it on every
 * input (`recordSlowOpBatch`), and a producer that judges before capturing
 * evidence calls it first and hands on the `attended` result — so a new op
 * kind cannot forget it: `timing` is required on every input.
 *
 * What comes off is only what was not already off. On a wall clock (a
 * browser) the tab was usually hidden through the nap (a closed lid), and the
 * browser took its `page-hidden` time off; on the awake clock (a backend) the
 * excluded part (gate waits, child ops) is the gate's or the child's, and a
 * wait filed on its own is judged here in its own turn. The two cannot be
 * placed against the unattended time, so only the unattended time beyond them
 * comes off — never the same second twice (an under-count: a slow op is never
 * hidden by more than the time it really spent unattended).
 *
 * The time stays visible: `sleep` and `dark-wake` layers on the row. Returns
 * the input with `timing: attended` — untouched in every other field when
 * nothing came off.
 */
export function attend(
  input: RecordSlowOpInput,
  clock: UnattendedClock,
): RecordSlowOpInput {
  const { timing } = input;
  if (timing.clock === "attended") return input;
  if (timing.clock === "unplaced") return { ...input, timing: ATTENDED };
  const endMs = timing.endedAtMs;
  const awake = timing.clock === "awake";
  // The op's wall window: on the awake clock its duration steps over the
  // sleeps inside it; on the wall clock it is the duration itself.
  const startMs = awake
    ? (clock.awakeSpanStart(endMs, input.durationMs) ??
      endMs - input.durationMs)
    : endMs - input.durationMs;
  const slept = awake ? 0 : Math.round(clock.sleptDuring(startMs, endMs) ?? 0);
  const dark = Math.round(clock.darkWakeDuring(startMs, endMs) ?? 0);
  if (slept <= 0 && dark <= 0) return { ...input, timing: ATTENDED };
  const alreadyOff = awake
    ? input.durationMs - input.ownMs
    : (input.waits?.[HIDDEN_LAYER] ?? 0);
  const off = Math.max(0, slept + dark - Math.max(0, alreadyOff));
  return {
    ...input,
    timing: ATTENDED,
    ownMs: Math.max(0, input.ownMs - off),
    waits: {
      ...input.waits,
      ...(slept > 0 && { [SLEEP_LAYER]: slept }),
      ...(dark > 0 && { [DARK_WAKE_LAYER]: dark }),
    },
  };
}

const ATTENDED = { clock: "attended" } as const;
