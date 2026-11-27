import { REPORT_OCCURRENCES_MAX, type ReportBody } from "@plugins/reports/core";

/**
 * How long a sent report's identical repeats are held and counted before they
 * go as one report carrying their count. An error thrown every frame (a rAF
 * callback, a per-frame handler: ~60–120/s) is then one request when it starts
 * and one per window while it lasts — never one per frame.
 */
export const REPORT_FOLD_WINDOW_MS = 10_000;

export interface ReportFoldDeps<R> {
  /** One send to the engine. May reject (it already retried). */
  send(body: ReportBody): Promise<R>;
  /** One-shot timer. */
  schedule(fn: () => void, delayMs: number): void;
  /** Where a held count's failed send is said (the console): never a report, which would loop. */
  warn(message: string): void;
  windowMs?: number;
}

export interface ReportFold<R> {
  /**
   * One occurrence. The first of its kind is sent at once and answers what
   * the engine answered; a repeat inside the window is counted and answers
   * the same as the send it folds into (the same row: identical bodies
   * fingerprint alike), or null when that send failed (warned once, by it).
   */
  submit(body: ReportBody): Promise<R | null>;
  /** Send every held count now (the page is going away). */
  flush(): void;
}

interface Entry<R> {
  /** The send the current window's repeats fold into. */
  leader: Promise<R>;
  /** Repeats counted since the leader, not sent yet. */
  held: number;
  /** The body every occurrence of this entry has (it is the entry's key). */
  body: ReportBody;
  /** Bumped by a flush, so the window's timer does not send the same count again. */
  generation: number;
}

/**
 * Folds a page's IDENTICAL reports (same body: kind, source, message, data,
 * url, tab, build) into one send per window, its `occurrences` the count —
 * the engine adds it to the row's `count` and `hourly`. Identity is the whole
 * body, strictly finer than any kind's fingerprint, so two reports the engine
 * keeps apart are never folded together, and nothing is lost: every
 * occurrence is counted, the first arrives at once, the rest within a window
 * (or at pagehide).
 *
 * Pure over its injected send and timer.
 */
export function createReportFold<R>(deps: ReportFoldDeps<R>): ReportFold<R> {
  const windowMs = deps.windowMs ?? REPORT_FOLD_WINDOW_MS;
  const entries = new Map<string, Entry<R>>();

  function arm(key: string, entry: Entry<R>): void {
    const generation = entry.generation;
    deps.schedule(() => {
      if (entries.get(key) !== entry || entry.generation !== generation) return;
      if (entry.held === 0) {
        // A quiet window: the next occurrence is news again, sent at once.
        entries.delete(key);
        return;
      }
      sendHeld(entry);
      arm(key, entry);
    }, windowMs);
  }

  function sendHeld(entry: Entry<R>): void {
    let left = entry.held;
    entry.held = 0;
    entry.generation += 1;
    while (left > 0) {
      const n = Math.min(left, REPORT_OCCURRENCES_MAX);
      left -= n;
      const sent = deps.send({ ...entry.body, occurrences: n });
      entry.leader = sent;
      sent.catch((err: unknown) => {
        deps.warn(
          `[reports] ${n} folded occurrence(s) not delivered (${entry.body.kind}/${entry.body.source}): ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
  }

  function submit(body: ReportBody): Promise<R | null> {
    const key = JSON.stringify(body);
    const known = entries.get(key);
    if (known) {
      known.held += 1;
      // The leader's own caller already hears (and warns about) its failure;
      // a repeat is not a second failure to say.
      return known.leader.then(
        (r) => r,
        () => null,
      );
    }
    const entry: Entry<R> = {
      leader: deps.send(body),
      held: 0,
      body,
      generation: 0,
    };
    entries.set(key, entry);
    arm(key, entry);
    return entry.leader;
  }

  function flush(): void {
    for (const [key, entry] of entries) {
      if (entry.held === 0) continue;
      sendHeld(entry);
      // A page restored from the back/forward cache keeps counting.
      arm(key, entry);
    }
  }

  return { submit, flush };
}
