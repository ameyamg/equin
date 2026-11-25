import {
  createTurnEndTracker,
  type TurnEnd,
} from "@plugins/conversations/plugins/transcript-source/core";

/**
 * The turn a replay hands to the waits on a conversation, read from its whole
 * transcript chain: its latest finished turn — found by the live path's own
 * tracker, so the two cannot disagree on which turn that is or when it ended —
 * if it ended once a wait was armed (`firstArmedAt`, the earliest trigger row
 * keyed to the conversation). One that ended before every wait is no wait's
 * turn: each was armed while a LATER turn ran, and waits for that one's end.
 *
 * Nor one that ended once the conversation was followed again
 * (`followedSince`): the live path announces that one, to every wait — a
 * wait armed a moment after the end line was written is waiting on exactly
 * that turn, and a late announcement winning the race would leave it out.
 *
 * The answer is emitted late (`armedBefore: endedAt`), so of several waits
 * only those armed by the time it ended hear it.
 */
export function lateTurn(
  lines: Iterable<Record<string, unknown>>,
  window: { firstArmedAt: Date; followedSince: Date },
): TurnEnd | null {
  const tracker = createTurnEndTracker();
  let latest: TurnEnd | null = null;
  for (const line of lines) latest = tracker.feed(line) ?? latest;
  if (latest === null) return null;
  const endedAt = Date.parse(latest.endedAt);
  return endedAt >= window.firstArmedAt.getTime() &&
    endedAt < window.followedSince.getTime()
    ? latest
    : null;
}
