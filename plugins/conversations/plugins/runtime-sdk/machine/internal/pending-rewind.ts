import { rename, rm, writeFile } from "node:fs/promises";
import { z } from "zod";
import { joinAppPath } from "@plugins/infra/plugins/host-fs/plugins/user-path/core";
import { exists, readFile } from "@plugins/packages/plugins/timed-fs/core";
import { agentDir } from "./paths";

// Stop takes an unanswered turn back by relaunching the agent with it dropped
// from the session (resumeSessionAt + resumeDropsTurn). That relaunch can fail
// — Claude Code not starting, a sign-in lost — after the old process is gone.
// The drop is then still owed: the turn's text went back to the composer, so
// the session must not keep it. This file is that debt, beside the agent's
// launch.json: written before Stop's relaunch, cleared by the start that
// settles it — dropping the turn, or (that start failing) resuming the
// session plainly with the turn kept, reported — and applied by whichever
// start resumes the same session next, so the user's next message never runs
// on top of the prompt they took back (conv-1795608764-h27peb, 2026-11-25).

const PENDING_REWIND_FILE = "pending-rewind.json";

export const PendingRewindSchema = z.object({
  /** The session the turn is to be dropped from. */
  sessionId: z.string(),
  /** Where the kept part of the session ends; null: the turn opened it. */
  anchorUuid: z.string().nullable(),
  /** The transcript uuid of the turn to drop. */
  promptUuid: z.string(),
});
export type PendingRewind = z.infer<typeof PendingRewindSchema>;

function pendingRewindPath(id: string) {
  return joinAppPath(agentDir(id), PENDING_REWIND_FILE);
}

export async function writePendingRewind(
  id: string,
  rewind: PendingRewind,
): Promise<void> {
  const path = pendingRewindPath(id);
  const staging = `${path}.${String(process.pid)}.tmp`;
  await writeFile(staging, JSON.stringify(rewind));
  await rename(staging, path);
}

export async function readPendingRewind(
  id: string,
): Promise<PendingRewind | null> {
  const path = pendingRewindPath(id);
  if (!(await exists(path))) return null;
  return PendingRewindSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

export async function clearPendingRewind(id: string): Promise<void> {
  await rm(pendingRewindPath(id), { force: true });
}
