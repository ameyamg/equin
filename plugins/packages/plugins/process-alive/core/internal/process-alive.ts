/**
 * Whether `pid` names a live process on this machine: `kill(pid, 0)` delivers
 * nothing and only asks. ESRCH — no such process — is dead; EPERM — another
 * account's process — is alive. Anything else is not an answer and throws.
 *
 * What it can and cannot say: a dead pid's process is gone for good, so
 * whatever it was writing is orphaned. A live pid may be a reuse of the
 * number by an unrelated process (after a reboot, or a long-gone writer's pid
 * recycled), so "alive" means "maybe still writing" — a sweep that keeps a
 * file for a live pid errs toward keeping, never toward deleting a live
 * writer's file. The writer's pid in a temp file's name is the liveness
 * signal a reaper should judge by, not the file's age: an age counts a nap,
 * and a writer mid-write across a Mac's sleep would lose its file to a
 * sweeper woken first.
 */
export function isProcessAlive(pid: number): boolean {
  return signalZero(pid, pid);
}

/**
 * Whether any process of the group `pgid` is still alive: `kill(-pgid, 0)`,
 * with {@link isProcessAlive}'s reading of ESRCH and EPERM. A group outlives
 * its leader — an orphaned member keeps its pgid after re-parenting — so a
 * caller that signals work as a group judges its liveness as one too. On
 * macOS a member still tearing down after a SIGKILL answers EPERM for a few
 * milliseconds: alive, which only defers a caller's close to its next look.
 */
export function isProcessGroupAlive(pgid: number): boolean {
  return signalZero(pgid, -pgid);
}

function signalZero(id: number, target: number): boolean {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`[process-alive] not a pid: ${id}`);
  }
  try {
    process.kill(target, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw err;
  }
}

/**
 * The writer pid a temp file's name carries, read by `pattern` (its first
 * capture group must be the pid), or `null` when the name does not match.
 */
export function writerPidOf(name: string, pattern: RegExp): number | null {
  const m = pattern.exec(name);
  if (m?.[1] === undefined) return null;
  const pid = Number(m[1]);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

/**
 * Whether a pid-tagged temp file is orphaned: its name names a writer, and
 * that writer is gone. A name with no writer pid is an orphan too — every
 * writer this is used for tags its temps — so it never lingers forever.
 */
export function isOrphanedTemp(name: string, pattern: RegExp): boolean {
  const pid = writerPidOf(name, pattern);
  return pid === null || !isProcessAlive(pid);
}
