import { spawn } from "node:child_process";
import { mkdtempSync, openSync, readSync, rmSync, watch } from "node:fs";
import {
  existsSync,
  readFileSync,
} from "@plugins/packages/plugins/timed-fs/core";
import { writeAllSync } from "@plugins/packages/plugins/blocking-write/machine";
import { adoptFd } from "@plugins/packages/plugins/owned-fd/core";
import { isProcessAlive } from "@plugins/packages/plugins/process-alive/core";
import { constants, tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  setEnv,
  unsetEnv,
} from "@plugins/infra/plugins/launcher/plugins/env-names/core";
import { AWAIT_EXIT } from "@plugins/framework/plugins/cli/plugins/await/core";
import { isCallLimitSignal, type HandoffOp } from "../core";
import { wallNow } from "@plugins/packages/plugins/deadline/core";

const READ_CHUNK_BYTES = 64 * 1024;

/** Claude Code exports its own pid under this name to every command it runs. */
const AGENT_PID_ENV = "CLAUDE_PID";

/** Signals that end this launcher gracefully — and, unless it is the call's limit, the op with it. */
const ENDING_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/**
 * How often the launcher checks that the op's wrapper is still alive. Its exit
 * is announced by the status file it writes; only a wrapper SIGKILLed itself
 * writes none, and no file event will ever say so — the same reason
 * `./equin await` has a heartbeat. It is no longer this process's child, so
 * there is no `exit` event to wait on.
 */
const LIVENESS_HEARTBEAT_MS = 15_000;

const WRAPPER_PATH = join(import.meta.dir, "internal", "op-wrapper.ts");

const OpStatus = z.object({
  code: z.number().int().nullable(),
  signal: z.string().nullable(),
});

function signalExitCode(signal: string): number {
  const signo = (constants.signals as Record<string, number | undefined>)[
    signal
  ];
  return signo === undefined ? 1 : 128 + signo;
}

/**
 * Run `op` — this very invocation — OFF the agent's Bash call, stream its
 * output as if it ran here, and hand it off at `deadlineMs` if it has not
 * finished.
 *
 * **Off the call** means not a descendant of it. The harness ends a call at its
 * time limit (600 s foreground, ≤ 2 h background) by killing the call's whole
 * process tree, and the limit runs on the wall clock: a Mac that sleeps through
 * it kills the op the moment it wakes. On 2026-11-22 that ended four agent
 * builds that had had 1–3 min awake. So the op is started through
 * `internal/op-wrapper.ts`, which re-parents it to launchd: a process of the
 * agent's (`OP_HANDED_OFF` holds the agent's pid, which its orphan guard
 * follows), not of the call. A kill of the call — at any instant, by any signal
 * — cannot reach it.
 *
 * Why from the start: an op cannot be detached halfway. Its liveness marker is
 * a flock its process holds and its workers are its children, so the process
 * that must survive the call has to be the one that started the op. This
 * process is only a launcher — it writes no marker and takes no grant.
 *
 * - **Finishes in time:** its output was streamed as it came, and its exit
 *   code is this process's — indistinguishable from running in place.
 * - **Deadline**, or **a signal at or past it** (the harness's own limit,
 *   which after a sleep fires on wake, maybe before this timer): print where
 *   it stands and how to get its verdict, leave it running, exit 70
 *   (`./equin await`'s "still running" code).
 * - **Interrupted before the deadline** (the user stopped the call): the op's
 *   group is SIGTERMed with it, as an in-place op would have died — a
 *   hand-off is the limit's answer, not an interrupt's. By this process's
 *   handlers for a catchable signal, and by the wrapper for every other way
 *   this process can die (SIGKILL, a crash): it watches this pid and applies
 *   the same judgement.
 *
 * The output goes to a file, never a pipe: a pipe dies with its reader, and the
 * op must keep writing after this process is gone.
 */
export async function runHandedOff(
  op: HandoffOp,
  deadlineMs: number,
): Promise<never> {
  // This launcher owns the directory: removed once the op has exited in time
  // (everything in it was streamed out already). Left behind, one per
  // foreground check / test, it piled up — 2,700+ in /tmp on 2026-11-05.
  // A handed-off op's log outlives the call on purpose: its path is printed.
  const owner = handOffOwner();
  const logDir = mkdtempSync(join(tmpdir(), `equin-${op}-`));
  const logPath = join(logDir, "output.log");
  const statusPath = join(logDir, "status.json");
  const pidPath = join(logDir, "wrapper.pid");
  const writeFd = adoptFd(openSync(logPath, "a"));
  const env = { ...process.env };
  unsetEnv("CALL_DEADLINE", env);
  setEnv("OP_HANDED_OFF", String(owner), env);
  // A session leader of its own, so the whole op is one process group to stop.
  const starter = spawn(
    process.execPath,
    [
      WRAPPER_PATH,
      "detach",
      statusPath,
      pidPath,
      String(process.pid),
      String(Math.max(1, Math.floor(deadlineMs))),
      "--",
      process.execPath,
      ...process.argv.slice(1),
    ],
    {
      cwd: process.cwd(),
      env,
      detached: true,
      stdio: ["ignore", writeFd.fd, writeFd.fd],
    },
  );
  writeFd.close();
  const opGroup = starter.pid;
  if (opGroup === undefined)
    throw new Error(`call hand-off: the ${op} did not start`);
  const started = await new Promise<number | null>((resolve, reject) => {
    starter.on("error", reject);
    starter.on("exit", (code) => resolve(code));
  });
  if (started !== 0 || !existsSync(pidPath)) {
    process.stdout.write(readFileSync(logPath));
    throw new Error(
      `call hand-off: the ${op}'s starter exited ${started} without starting it (output above)`,
    );
  }
  const wrapperPid = Number(readFileSync(pidPath, "utf8"));

  let leftRunning = false;
  let ended = false;
  const stopOp = () => {
    if (leftRunning || ended) return;
    try {
      // The whole group: the op and every worker it started.
      process.kill(-opGroup, "SIGTERM");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
    }
  };

  // Synchronous writes: every byte must be out before `process.exit`. A
  // reader that went away (`./equin push | head -20`) ends the streaming, not
  // the op: its output is still in the file, and the push still lands.
  let streaming = true;
  const out = (bytes: string | Uint8Array) => {
    if (!streaming) return;
    try {
      writeAllSync(1, bytes);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EPIPE") throw err;
      streaming = false;
    }
  };
  const readFd = adoptFd(openSync(logPath, "r"));
  let offset = 0;
  const pump = () => {
    for (;;) {
      if (!streaming) return;
      const chunk = Buffer.alloc(READ_CHUNK_BYTES);
      const n = readSync(readFd.fd, chunk, 0, chunk.length, offset);
      if (n <= 0) return;
      offset += n;
      out(chunk.subarray(0, n));
    }
  };

  const handOff = (why: string): never => {
    leftRunning = true;
    pump();
    out(
      `\n⏸ ${op} is still running — ${why}; it keeps going on its own (pid ${wrapperPid}'s child), across any sleep.\n` +
        `  Next: \`./equin await ${op}\` (foreground). It blocks until the ${op} writes its verdict and prints it; ` +
        `exit 70 means still going — call it again. No notification will come, so do not end your turn waiting for one.\n` +
        `  Its full output, so far and from here on: ${logPath}\n`,
    );
    process.exit(AWAIT_EXIT.stillRunning);
  };

  // The one place an ending signal is judged: the call's limit leaves the op
  // running, anything earlier stops it.
  process.on("exit", () => {
    if (!isCallLimitSignal(wallNow("external"), deadlineMs)) stopOp();
  });
  for (const sig of ENDING_SIGNALS)
    process.on(sig, () => {
      if (isCallLimitSignal(wallNow("external"), deadlineMs))
        handOff(`this call reached its time limit (${sig})`);
      stopOp();
      process.exit(signalExitCode(sig));
    });

  const readStatus = (): z.infer<typeof OpStatus> | null =>
    existsSync(statusPath)
      ? OpStatus.parse(JSON.parse(readFileSync(statusPath, "utf8")))
      : null;

  type Ending =
    | { kind: "exited"; code: number }
    | { kind: "vanished" }
    | { kind: "deadline" };
  const ending = await new Promise<Ending>((resolve) => {
    const settle = () => {
      pump();
      const status = readStatus();
      if (status !== null)
        resolve({
          kind: "exited",
          code:
            status.code ??
            (status.signal !== null ? signalExitCode(status.signal) : 1),
        });
    };
    // The directory: the output growing and the status file landing.
    watch(logDir, settle);
    setInterval(() => {
      settle();
      if (!isProcessAlive(wrapperPid) && readStatus() === null)
        resolve({ kind: "vanished" });
    }, LIVENESS_HEARTBEAT_MS);
    // The call's limit is the harness's, on the wall clock: so is this.
    setTimeout(
      () => resolve({ kind: "deadline" }),
      Math.max(0, deadlineMs - wallNow("external")),
    );
    settle();
  });
  // Every ending below exits the process, which closes the watcher and timers.
  pump();

  if (ending.kind === "exited") {
    ended = true;
    readFd.close();
    rmSync(logDir, { recursive: true, force: true });
    process.exit(ending.code);
  }
  if (ending.kind === "vanished") {
    // Its wrapper was killed on its own (it writes a status for every end of
    // the op): the op may still run, parentless, with nobody to relay its
    // exit. Stopped, so nothing runs that no verdict will ever come from.
    stopOp();
    ended = true;
    out(
      `\n✗ ${op} ended without an exit status: its wrapper (pid ${wrapperPid}) was killed, and the rest of its process group was stopped. Its output: ${logPath}\n`,
    );
    process.exit(1);
  }
  return handOff("handed off before this call's time limit");
}

/**
 * The agent this hand-off's op belongs to: the Claude Code process that ran
 * the call, which exports its own pid to every command it runs. Only an
 * agent's call has a deadline (the `call-deadline` guard is a Claude Code
 * hook), so an owner is always there — and an op handed off with none would
 * outlive everyone who could await it: thrown, before anything starts.
 */
function handOffOwner(): number {
  const raw = process.env[AGENT_PID_ENV];
  const pid = Number(raw);
  if (raw === undefined || !Number.isSafeInteger(pid) || pid <= 1) {
    throw new Error(
      `call hand-off: no owning agent — ${AGENT_PID_ENV} is ${JSON.stringify(raw)}, expected the pid of the Claude Code process that ran this call`,
    );
  }
  return pid;
}
