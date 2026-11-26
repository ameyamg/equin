import { z } from "zod";
import { defineJob } from "@plugins/infra/plugins/jobs/server";
import { defineTimer } from "@plugins/infra/plugins/background/plugins/timer/server";

// The change signal's fallback (design §5). The provider's push (Gmail:
// Pub/Sub, `providers/gmail`) is the signal when it is live; without it the
// provider signals nothing, so this is the no-polling rule's documented
// exception: a sync step (`history.list`, 2 units when nothing moved) every
// 30 s while anyone watches a mail view and push is not live (served.ts'
// `reconcileTick`), and one every 10 min on main whatever push says, which
// keeps the cursor inside Gmail's history window (a cursor that falls out of
// it is a reset: every summary re-read) and catches a notification Google
// dropped (it says push may). Push does not retire the tick: before setup, in
// a worktree that did not set it up, and while push is down, it is the
// signal.

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
      "Reads the mail account's changes every 30 seconds while a mail view is open and push is not live, so mail archived, read or received elsewhere shows up without a reload — the fallback before Gmail push is set up, in a worktree without it, and while it is down.",
    everyMs: SYNC_TICK_MS,
    run: sync,
  });
  const idleJob = defineJob({
    name: "mail.sync-idle",
    description:
      "Reads the mail account's changes every 10 minutes, so the cache stays current with nobody watching, a change whose push notification Google dropped is caught, and its change cursor never ages out of Gmail's history.",
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
