/**
 * The account pacer, replayed on report-1795721286-0gc0z2's minute: body
 * prefetch spent first, then the person's own reads — does a view opened
 * next get its fill at once?
 *
 * 2026-11-26 19:26:55–57 UTC, 18 prefetched bodies (`threads.get` full, 120
 * each); 19:27:45, the Inbox scroll's 94 summaries (`threads.get`
 * metadata, 40 each); 19:27:51, "With attachments" opened. Its fill is
 * measured at today's page (`MAIL_THREADS_PAGE` 25 rows, read as 27
 * summaries and one list page: 1,085 units).
 *
 * Before (the pacer as it ran then: prefetch at `background`, background
 * allowed half the window), the fill waited for the prefetch to age out of
 * the window. Now prefetch is `speculative` and spends only what is idle:
 * 6 bodies (720 units) at most while the window is busy, the rest held
 * while the person reads, so the fill is admitted at once.
 */

import { describe, expect, test } from "bun:test";
import {
  createQuotaPacer,
  GMAIL_QUOTA,
  type GmailPriority,
  type PacerClock,
  type QuotaPacer,
} from "@plugins/integrations/plugins/gmail/plugins/api/core";
import { createAccountPacer } from "./accounts";

function fakeClock() {
  let now = 0;
  let next = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: PacerClock = {
    now: () => now,
    setTimeout(fn, ms) {
      const id = next++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
  };
  return {
    clock,
    now: () => now,
    async advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
        await Promise.resolve();
      }
      now = until;
      await Promise.resolve();
    },
  };
}

const BODY = GMAIL_QUOTA["threads.get"].full;
const SUMMARY = GMAIL_QUOTA["threads.get"].metadata;
const FILL = GMAIL_QUOTA["messages.list"] + 27 * SUMMARY;

/** Replays the minute; answers how long the new view's fill waited (ms). */
async function replay(
  pacer: QuotaPacer,
  c: ReturnType<typeof fakeClock>,
  prefetchAt: GmailPriority,
): Promise<{ fillWaitMs: number; bodiesAdmitted: number }> {
  let bodiesAdmitted = 0;
  // 19:26:55 — 18 bodies prefetched.
  for (let i = 0; i < 18; i++) {
    void pacer.acquire(BODY, { priority: prefetchAt }).then(() => {
      bodiesAdmitted++;
    });
  }
  await c.advance(50_000);
  // 19:27:45 — the Inbox scroll's summaries, in batches of 20.
  for (let left = 94; left > 0; left -= 20) {
    await pacer.acquire(Math.min(20, left) * SUMMARY, {
      priority: "foreground",
    });
  }
  await c.advance(6_000);
  // 19:27:51 — the new view's fill.
  const asked = c.now();
  let admittedAt: number | null = null;
  void pacer.acquire(FILL, { priority: "foreground" }).then(() => {
    admittedAt = c.now();
  });
  await c.advance(0);
  const bodiesBeforeFill = bodiesAdmitted;
  for (let i = 0; i < 70 && admittedAt === null; i++) await c.advance(1_000);
  if (admittedAt === null) throw new Error("the fill was never admitted");
  return { fillWaitMs: admittedAt - asked, bodiesAdmitted: bodiesBeforeFill };
}

describe("the Gmail account pacer, on report-1795721286-0gc0z2's minute", () => {
  test("before: prefetch at background, half the window — the fill waits", async () => {
    const c = fakeClock();
    const before = createQuotaPacer({ backgroundShare: 0.5, clock: c.clock });
    const r = await replay(before, c, "background");
    expect(r.bodiesAdmitted).toBe(18);
    expect(r.fillWaitMs).toBe(4_000);
  });

  test("now: prefetch is speculative — the fill is admitted at once", async () => {
    const c = fakeClock();
    const r = await replay(createAccountPacer(c.clock), c, "speculative");
    // Prefetch spent only the idle 720 units; the other 12 bodies wait.
    expect(r.bodiesAdmitted).toBe(6);
    expect(r.fillWaitMs).toBe(0);
  });
});
