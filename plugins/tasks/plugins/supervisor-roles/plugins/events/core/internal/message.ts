import { MESSAGE_LINES_SHOWN, type EventLine } from "./entities";

/**
 * How long the first event after a quiet period waits for the rest of its
 * burst: a crash filing several reports at once goes out as one message, not
 * as its first report followed by the rest a whole gap later.
 */
export const GATHER_WINDOW_MS = 5_000;

/**
 * When a role's gathered events go out: the later of the end of the quiet
 * period its last message started (`lastMessageAt` + `gapMs`; any outcome)
 * and the end of the gathering window its first waiting event opened
 * (`firstPendingAt` + {@link GATHER_WINDOW_MS}) — never before `now`.
 *
 * Derived from stored instants only, so every event of a burst and the flush
 * that sends them compute the same time. `lastMessageAt` is null when the
 * role has no message yet, `firstPendingAt` when nothing is waiting.
 */
export function nextMessageAt({
  lastMessageAt,
  gapMs,
  firstPendingAt,
  now,
}: {
  lastMessageAt: Date | null;
  gapMs: number;
  firstPendingAt: Date | null;
  now: Date;
}): Date {
  const ends = [now.getTime()];
  if (lastMessageAt !== null) ends.push(lastMessageAt.getTime() + gapMs);
  if (firstPendingAt !== null)
    ends.push(firstPendingAt.getTime() + GATHER_WINDOW_MS);
  return new Date(Math.max(...ends));
}

/** One summarized line: `×3 crash · Uncaught TypeError … (rep-…)`. */
export function renderEventLine(l: EventLine): string {
  return `×${l.count} ${l.kind} · ${l.title}${l.ref === null ? "" : ` (${l.ref})`}`;
}

/** How many kinds the `+N more` line names before it says `+M kinds`. */
const MORE_KINDS_SHOWN = 6;

function sumEvents(lines: readonly EventLine[]): number {
  return lines.reduce((n, l) => n + l.count, 0);
}

/**
 * The line standing for the lines a message does not show:
 * `+82 more · 1400 events (1300 job-attempt-failed, 100 crash)`.
 */
export function renderMoreLine(hidden: readonly EventLine[]): string {
  const byKind = new Map<string, number>();
  for (const l of hidden)
    byKind.set(l.kind, (byKind.get(l.kind) ?? 0) + l.count);
  const kinds = [...byKind].sort((a, b) => b[1] - a[1]);
  const named = kinds
    .slice(0, MORE_KINDS_SHOWN)
    .map(([kind, n]) => `${n} ${kind}`);
  if (kinds.length > MORE_KINDS_SHOWN)
    named.push(`+${kinds.length - MORE_KINDS_SHOWN} kinds`);
  const events = sumEvents(hidden);
  return `+${hidden.length} more · ${events} ${events === 1 ? "event" : "events"} (${named.join(", ")})`;
}

/**
 * A message's text: a header naming how much it folds, then one line per
 * event, most frequent first — always a summary, never a whole report (the
 * ref says where to read one). Past {@link MESSAGE_LINES_SHOWN} lines the
 * rest are summed by kind in one `+N more` line, and the message's id says
 * where to read every line (`read_event_message`).
 */
export function renderEventMessage(
  lines: readonly EventLine[],
  streamLabel: (id: string) => string,
  since: Date | null,
  messageId: string,
): string {
  const events = sumEvents(lines);
  const streams = [...new Set(lines.map((l) => streamLabel(l.streamId)))];
  const head =
    `${streams.join(", ")} — ${events} ${events === 1 ? "event" : "events"}` +
    (lines.length > 1 ? ` · ${lines.length} distinct` : "") +
    (since === null ? "" : ` since ${since.toISOString().slice(11, 16)} UTC`);
  const shown = lines.slice(0, MESSAGE_LINES_SHOWN);
  const hidden = lines.slice(MESSAGE_LINES_SHOWN);
  const body = shown.map((l) => `- ${renderEventLine(l)}`);
  if (hidden.length === 0) return [head, ...body].join("\n");
  return [
    head,
    ...body,
    `- ${renderMoreLine(hidden)}`,
    "",
    `Every line: \`read_event_message\` ${messageId}`,
  ].join("\n");
}
