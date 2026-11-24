import type { OpKind } from "@plugins/infra/plugins/worktree/core";

/**
 * The ops an agent's Bash call runs OFF the call: as a process the harness
 * cannot kill, streamed into the call while it lasts and handed off at its
 * time limit (`../cli`).
 *
 * The harness ends a call at its `timeout` — 600 s in the foreground, 2 h at
 * most in the background — and that limit is WALL time: it keeps running while
 * the Mac sleeps, and on wake it fires at once. Before this list held `build`
 * and `push`, an op was a descendant of the call, and the harness's kill walks
 * the descendants: on 2026-11-22 four agent builds that had run 1–3 min awake
 * were SIGTERMed at 31 / 61 / 121 / 121 min of wall clock, the rest of it
 * sleep (build-1795314400-qbng8n, -1795322586-osbieh, -1795343567-5hlm5g,
 * -1795344567-lbj1mk). An op handed off survives the call, across any number
 * of sleeps, and `./equin await <op>` reads its verdict.
 *
 * A closed list of op kinds, read by the guard (which calls get a deadline)
 * and the CLI mapper (which commands hand off) — one list, so the two cannot
 * disagree.
 */
export const HANDOFF_OPS = [
  "build",
  "push",
  "check",
  "test",
] as const satisfies readonly OpKind[];

export type HandoffOp = (typeof HANDOFF_OPS)[number];

export function isHandoffOp(name: string): name is HandoffOp {
  return (HANDOFF_OPS as readonly string[]).includes(name);
}

/**
 * The hand-off ops an agent may run in a FOREGROUND Bash call. These two are
 * short often enough that forcing them into the background costs more than it
 * saves — op-log, 30 days: `test` p50 35 s, `check` p50 192 s — yet long often
 * enough (11% / 20% past 570 s, host-grant queue included) that the 600 s limit
 * must never be what ends them. `build` and `push` stay background-only: most
 * of their runs would hand off anyway.
 */
export const FOREGROUND_OPS = [
  "check",
  "test",
] as const satisfies readonly HandoffOp[];

export function isForegroundOp(name: string): boolean {
  return (FOREGROUND_OPS as readonly string[]).includes(name);
}

/**
 * How long before the call's limit the op hands off. Covers the CLI's own start
 * (dependency check, re-exec), the gap between the guard stamping the deadline
 * and the harness starting its clock, and the last output drain — with room to
 * spare, since handing off a minute early costs one `./equin await`, while
 * missing the limit costs the call's own exit (the op survives either way).
 */
export const HANDOFF_MARGIN_MS = 60_000;

/** The instant (epoch ms) an op in a call with `timeoutMs` must hand off by. */
export function callDeadline(nowMs: number, timeoutMs: number): number {
  return nowMs + timeoutMs - HANDOFF_MARGIN_MS;
}

/**
 * Whether a signal that reached the launcher at `nowMs` is the harness ending
 * the call at its limit, rather than someone stopping it.
 *
 * The harness's limit is on the wall clock, so after a sleep it fires the
 * moment the machine wakes — possibly before the launcher's own deadline timer
 * has run. Anything at or past the deadline is that limit: the op is left
 * running. Earlier, it is an interrupt (Esc, TaskStop): the op is stopped with
 * the call, as an in-place op would have been.
 */
export function isCallLimitSignal(nowMs: number, deadlineMs: number): boolean {
  return nowMs >= deadlineMs;
}
