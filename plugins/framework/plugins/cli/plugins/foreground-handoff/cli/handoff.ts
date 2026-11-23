import { spawn } from "node:child_process";
import { mkdtempSync, openSync, readSync, rmSync, watch } from "node:fs";
import { writeAllSync } from "@plugins/packages/plugins/blocking-write/machine";
import { adoptFd } from "@plugins/packages/plugins/owned-fd/core";
import { constants, tmpdir } from "node:os";
import { join } from "node:path";
import {
  setEnv,
  unsetEnv,
} from "@plugins/infra/plugins/launcher/plugins/env-names/core";
import { AWAIT_EXIT } from "@plugins/framework/plugins/cli/plugins/await/core";
import type { HandoffOp } from "../core";
import { wallNow } from "@plugins/packages/plugins/deadline/core";

const READ_CHUNK_BYTES = 64 * 1024;

/** Claude Code exports its own pid under this name to every command it runs. */
const AGENT_PID_ENV = "CLAUDE_PID";

/** Signals that end this launcher gracefully — and, with it, the op it owns. */
const ENDING_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

function signalExitCode(signal: NodeJS.Signals): number {
  return 128 + constants.signals[signal];
}

/**
 * Run `op` — this very invocation — as a detached child, stream its output as
 * if it ran here, and hand it off at `deadlineMs` if it has not finished.
 *
 * Why a child from the start: an op cannot be detached halfway. Its liveness
 * marker is a flock its process holds and its workers are its children, so the
 * process that must survive the call has to be the one that started the op.
 * This process is only a launcher — it writes no marker and takes no grant.
 *
 * - **Finishes in time:** its output was streamed as it came, and its exit
 *   code is this process's — indistinguishable from running in place.
 * - **Deadline:** print where it stands and how to get its verdict, leave it
 *   running, exit 70 (`./equin await`'s "still running" code). The op's
 *   orphan guard follows the AGENT instead of this launcher (`OP_HANDED_OFF`
 *   holds the agent's pid), so this exit does not kill it — the agent's does:
 *   once the agent is gone, nobody can `./equin await` the op any more.
 * - **This launcher is interrupted or orphaned** before the deadline (the user
 *   stopped the call): the op is SIGTERMed with it, as an in-place op would
 *   have died — a hand-off is the deadline's answer, not an interrupt's.
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
  const writeFd = adoptFd(openSync(logPath, "a"));
  const env = { ...process.env };
  unsetEnv("FOREGROUND_DEADLINE", env);
  setEnv("OP_HANDED_OFF", String(owner), env);
  const child = spawn(process.execPath, process.argv.slice(1), {
    cwd: process.cwd(),
    env,
    detached: true,
    stdio: ["ignore", writeFd.fd, writeFd.fd],
  });
  writeFd.close();

  let handedOff = false;
  process.on("exit", () => {
    if (handedOff || child.pid === undefined) return;
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      // The whole group: the op and every worker it started.
      process.kill(-child.pid, "SIGTERM");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
    }
  });
  for (const sig of ENDING_SIGNALS)
    process.on(sig, () => process.exit(signalExitCode(sig)));

  const readFd = adoptFd(openSync(logPath, "r"));
  let offset = 0;
  // Synchronous writes: every byte must be out before `process.exit`.
  const pump = () => {
    for (;;) {
      const chunk = Buffer.alloc(READ_CHUNK_BYTES);
      const n = readSync(readFd.fd, chunk, 0, chunk.length, offset);
      if (n <= 0) return;
      offset += n;
      writeAllSync(1, chunk.subarray(0, n));
    }
  };
  const watcher = watch(logPath, () => pump());

  type Ending = { kind: "exited"; code: number } | { kind: "deadline" };
  const ending = await new Promise<Ending>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) =>
      resolve({
        kind: "exited",
        code: code ?? (signal ? signalExitCode(signal) : 1),
      }),
    );
    // One-shot: the deadline is an instant, not a loop.
    setTimeout(
      () => resolve({ kind: "deadline" }),
      Math.max(0, deadlineMs - wallNow("external")),
    ).unref();
  });
  watcher.close();
  pump();
  readFd.close();

  if (ending.kind === "exited") {
    rmSync(logDir, { recursive: true, force: true });
    process.exit(ending.code);
  }

  handedOff = true;
  child.unref();
  writeAllSync(
    1,
    `\n⏸ ${op} is still running — handed off before this call's time limit; it keeps going on its own (pid ${child.pid}).\n` +
      `  Next: \`./equin await ${op}\` (foreground). It blocks until the ${op} writes its verdict and prints it; ` +
      `exit 70 means still going — call it again. No notification will come, so do not end your turn waiting for one.\n` +
      `  Its full output, so far and from here on: ${logPath}\n`,
  );
  process.exit(AWAIT_EXIT.stillRunning);
}

/**
 * The agent this hand-off's op belongs to: the Claude Code process that ran
 * the foreground call, which exports its own pid to every command it runs. Only
 * a foreground call of an agent has a deadline (the `foreground-deadline`
 * guard is a Claude Code hook), so an owner is always there — and an op handed
 * off with none would outlive everyone who could await it: thrown, before
 * anything starts.
 */
function handOffOwner(): number {
  const raw = process.env[AGENT_PID_ENV];
  const pid = Number(raw);
  if (raw === undefined || !Number.isSafeInteger(pid) || pid <= 1) {
    throw new Error(
      `foreground hand-off: no owning agent — ${AGENT_PID_ENV} is ${JSON.stringify(raw)}, expected the pid of the Claude Code process that ran this call`,
    );
  }
  return pid;
}
