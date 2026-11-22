import {
  readProcRusage,
  type ProcRusage,
} from "@plugins/packages/plugins/proc-rusage/core";
import { readAwakeClock, type AwakeClockReading } from "./sleep-clock";

/**
 * How long another process has run, in AWAKE time — for judging its age from
 * outside it (a reaper, a sweep), where `ps etime` counts every sleep since it
 * started: a process started just before a night's sleep reads 8 h old at the
 * first wake, though it ran for seconds.
 */
export type ProcessAwakeAge =
  /** The time the machine was awake since `pid` started, ms. */
  | { kind: "awake"; awakeMs: number }
  /** The kernel refused: another account's process, or one gone since. */
  | { kind: "refused" }
  /** No awake clock or no start record here (off macOS) — NOT "it is new". */
  | { kind: "unsupported" };

/**
 * The awake age from a usage record and an awake-clock reading (pure, for
 * tests). On macOS the kernel stamps a process's start
 * (`ri_proc_start_abstime`) on mach_absolute_time, the clock
 * `readAwakeClock` reads (CLOCK_UPTIME_RAW), which pauses through sleep — so
 * their difference is the process's awake age, exactly. Measured 2026-11-23:
 * this process's own read 307.8 ms against `performance.now()` 302 ms.
 *
 * Linux's start record (`/proc/<pid>/stat` starttime) counts suspend, so a
 * Linux reading is `unsupported` — the awake clock is too.
 */
export function judgeProcessAwakeAge(
  usage: ProcRusage,
  clock: AwakeClockReading,
): ProcessAwakeAge {
  if (usage.kind === "refused") return { kind: "refused" };
  if (usage.kind !== "read" || !clock.supported) return { kind: "unsupported" };
  return {
    kind: "awake",
    awakeMs: Math.max(0, clock.awakeMs - usage.startedNs / 1e6),
  };
}

/** `pid`'s awake age, read now (one `proc_pid_rusage` and one clock read). */
export async function readProcessAwakeAge(
  pid: number,
): Promise<ProcessAwakeAge> {
  if (process.platform !== "darwin") return { kind: "unsupported" };
  const usage = await readProcRusage(pid);
  return judgeProcessAwakeAge(usage, readAwakeClock());
}
