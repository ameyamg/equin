import { z } from "zod";
import { defineJob } from "@plugins/infra/plugins/jobs/server";
import { defineTimer } from "@plugins/infra/plugins/background/plugins/timer/server";

// The change signal (design §5). Without Gmail push (Pub/Sub, design step 8)
// the provider gives no signal at all, so this is the no-polling rule's
// documented exception: a sync step (`history.list`, 2 units when nothing
// moved) every 30 s while anyone watches a mail view, and one every 10 min on
// main with nobody watching, which keeps the cursor inside Gmail's history
// window (a cursor that falls out of it is a reset: every summary re-read).
// Push will not retire the tick: worktrees never consume the subscription,
// and Google says push may drop notifications.

/** The tick's period while a mail view is open. */
export const SYNC_TICK_MS = 30_000;
/** The idle job's period (its cron below says the same). */
export const SYNC_IDLE_MS = 10 * 60_000;

/**
 * The tick and the idle job over one sync entry (the cache's `sync`, every
 * account it holds). Mount both in `register`; start the tick while
 * `mail.threads` is subscribed.
 */
export function mailChangeSignal(sync: () => Promise<void>) {
  const tick = defineTimer({
    name: "mail.sync-tick",
    description:
      "Reads the mail account's changes every 30 seconds while a mail view is open, so mail archived, read or received elsewhere shows up without a reload — the fallback until Gmail push is set up.",
    everyMs: SYNC_TICK_MS,
    run: sync,
  });
  const idleJob = defineJob({
    name: "mail.sync-idle",
    description:
      "Reads the mail account's changes every 10 minutes while no mail view is open, so the cache stays current and its change cursor never ages out of Gmail's history.",
    // One history read, plus the changed threads' summaries: a few paced calls.
    hold: "seconds",
    input: z.object({}),
    event: z.never(),
    dedup: "singleton",
    schedule: { cron: "*/10 * * * *" }, // main only: a worktree's cache ticks only while watched
    run: sync,
  });
  return { tick, idleJob };
}
