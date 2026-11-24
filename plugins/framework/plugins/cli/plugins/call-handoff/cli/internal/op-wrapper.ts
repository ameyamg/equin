// The process between the hand-off launcher and the op: run by Bun directly
// (`<bun> op-wrapper.ts <role> …`), node builtins and three small modules only, so
// it starts in milliseconds and holds next to nothing for the op's life.
//
// Two roles, one file:
//
// - `detach <statusPath> <pidPath> <launcherPid> <deadlineMs> -- <argv…>` — the launcher's own child, a
//   session leader (`detached: true`). Starts `wrap` and exits at once, so
//   `wrap` and the op below it are re-parented to launchd: no longer
//   descendants of the agent's Bash call. That is the point. The harness ends a
//   call at its time limit by killing the call's descendants — every one, a
//   setsid'd process group included (measured 2026-11-24: a `setsid` child of
//   a background call died at the limit; a re-parented one lived) — and that
//   limit is wall time, so a Mac that slept through it kills the op the moment
//   it wakes. Writes `wrap`'s pid to `pidPath` before exiting.
// - `wrap <statusPath> <launcherPid> <deadlineMs> <group> -- <argv…>` — the op's
//   parent for its whole life. When the op ends, however it ends (SIGKILL and
//   OOM included), writes `{ code, signal }` to `statusPath`, so the launcher —
//   which can no longer wait on the op as a child — still relays its exact
//   exit. It also watches the launcher: one gone BEFORE the deadline was
//   stopped (Esc, TaskStop — by any signal, SIGKILL included, which the
//   launcher's own handlers never see) or crashed, and the op is stopped with
//   it, as an in-place op would have been; one gone at or past it is the call's
//   limit, and the op runs on (`isCallLimitSignal`, the launcher's judgement).
//
// Every process here stays in the session `detach` started, so the launcher
// can still stop the whole op with one `kill(-pgid)` when its call is
// interrupted rather than timed out.
import { spawn } from "node:child_process";
import { renameSync, writeFileSync } from "node:fs";
import { wallNow } from "@plugins/packages/plugins/deadline/core";
import { isProcessAlive } from "@plugins/packages/plugins/process-alive/core";
import { isCallLimitSignal } from "../../core";

/** How often `wrap` checks its launcher is alive: it is no child to wait on. */
const LAUNCHER_POLL_MS = 2_000;

function intArg(value: string | undefined, what: string): number {
  const n = Number(value);
  if (value === undefined || !Number.isSafeInteger(n) || n <= 0)
    throw new Error(`op-wrapper: ${what} is ${JSON.stringify(value)}`);
  return n;
}

function writeAtomic(path: string, text: string): void {
  writeFileSync(`${path}.tmp`, text);
  renameSync(`${path}.tmp`, path);
}

function argvAfterDashes(args: string[]): string[] {
  const at = args.indexOf("--");
  const argv = at < 0 ? [] : args.slice(at + 1);
  if (argv.length === 0)
    throw new Error(
      `op-wrapper: no command after "--" in ${JSON.stringify(args)}`,
    );
  return argv;
}

const [role, statusPath, ...rest] = process.argv.slice(2);
if (statusPath === undefined) throw new Error("op-wrapper: no status path");

if (role === "detach") {
  const [pidPath, launcherPid, deadlineMs] = rest;
  if (pidPath === undefined) throw new Error("op-wrapper: no pid path");
  const argv = argvAfterDashes(rest);
  const wrapper = spawn(
    process.execPath,
    [
      import.meta.path,
      "wrap",
      statusPath,
      String(intArg(launcherPid, "the launcher pid")),
      String(intArg(deadlineMs, "the deadline")),
      // This process leads the session: its pid is the group's id.
      String(process.pid),
      "--",
      ...argv,
    ],
    {
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  if (wrapper.pid === undefined)
    throw new Error("op-wrapper: the wrapper did not start");
  writeAtomic(pidPath, String(wrapper.pid));
  wrapper.unref();
  process.exit(0);
} else if (role === "wrap") {
  const launcher = intArg(rest[0], "the launcher pid");
  const deadline = intArg(rest[1], "the deadline");
  const [bin, ...args] = argvAfterDashes(rest);
  // This session's group: `detach` led it, `wrap` and the op are in it.
  const group = intArg(rest[2], "the process group");
  setInterval(() => {
    if (isProcessAlive(launcher)) return;
    // The call's limit is the harness's, on the wall clock: so is this.
    if (isCallLimitSignal(wallNow("external"), deadline)) return;
    process.kill(-group, "SIGTERM");
  }, LAUNCHER_POLL_MS).unref();
  const op = spawn(bin!, args, { stdio: ["ignore", "inherit", "inherit"] });
  op.on("error", (err) => {
    writeAtomic(
      statusPath,
      JSON.stringify({ code: 127, signal: null, error: err.message }),
    );
    process.exit(127);
  });
  op.on("exit", (code, signal) => {
    writeAtomic(statusPath, JSON.stringify({ code, signal }));
    process.exit(code ?? 1);
  });
} else {
  throw new Error(`op-wrapper: unknown role ${JSON.stringify(role)}`);
}
