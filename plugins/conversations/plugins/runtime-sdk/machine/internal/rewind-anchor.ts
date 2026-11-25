import { claudeTranscriptPath } from "@plugins/infra/plugins/paths/server";

/**
 * Where a rewind resumes to drop a turn: the chain entry the turn's prompt
 * hangs off (its `parentUuid` in the session's own transcript) — the KEPT
 * turn's last chain entry, which is what the Agent SDK asks of
 * `resumeSessionAt` beside `resumeDropsTurn` (sdk.d.ts: "fork at the KEPT
 * turn's last chain entry, whatever it is"). `null`: the prompt opened the
 * session, so there is nothing to keep.
 *
 * Read from the transcript, never from the agent's events: the CLI can write
 * chain entries the agent never relayed. On 2026-11-25 (conv-1795608764-h27peb)
 * the agent was shut down while its CLI streamed a message: the events had the
 * message's thinking block, the transcript its text block too, and the next
 * Stop resumed at the thinking block — the CLI refused (the text block was not
 * the dropped turn's), the relaunch died at initialize and the Stop answered
 * 500.
 */
export function promptParentUuid(
  transcript: string,
  promptUuid: string,
): string | null {
  // Complete lines only: the CLI is still alive while Stop reads, and an
  // append caught mid-write is no entry yet.
  const lines = transcript.split("\n").slice(0, -1);
  // Newest first: the prompt is the session's latest turn (an earlier rewind
  // branch can hold an older copy of the same line).
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i]!;
    if (!raw.includes(promptUuid)) continue;
    const line = JSON.parse(raw) as { uuid?: unknown; parentUuid?: unknown };
    if (line.uuid !== promptUuid) continue;
    if (typeof line.parentUuid === "string") return line.parentUuid;
    if (line.parentUuid !== null)
      throw new Error(
        `transcript entry ${promptUuid} has no parentUuid (${JSON.stringify(line.parentUuid)})`,
      );
    // A null parent drops the whole session (a fresh start): only true when
    // the prompt opened it.
    if (lines.slice(0, i).some(isChainMessage))
      throw new Error(
        `transcript entry ${promptUuid} has a null parentUuid but follows earlier messages`,
      );
    return null;
  }
  throw new Error(`the transcript holds no entry ${promptUuid}`);
}

function isChainMessage(raw: string): boolean {
  const type = (JSON.parse(raw) as { type?: unknown }).type;
  return type === "user" || type === "assistant";
}

/** {@link promptParentUuid} read from the session file Claude Code resumes. */
export async function rewindAnchorUuid(
  cwd: string,
  sessionId: string,
  promptUuid: string,
): Promise<string | null> {
  const path = claudeTranscriptPath(cwd, sessionId);
  try {
    return promptParentUuid(await Bun.file(path).text(), promptUuid);
  } catch (err) {
    throw new Error(
      `cannot take turn ${promptUuid} back out of session ${sessionId} (${path}): ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}
