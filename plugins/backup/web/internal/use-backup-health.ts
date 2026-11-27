import { useEffect, useState } from "react";
import { useLive } from "@plugins/network/plugins/live/web";
import type { HealthStatus } from "@plugins/shell/plugins/health-report/web";
import { useDateFormatter } from "@plugins/fields/plugins/date/plugins/format/web";
import { backupHealth } from "../../core";
import { backupVerdict } from "./backup-health";

/** The longest delay setTimeout honours. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * The Backup row's `useStatus`: one subscription to a small pushed value.
 *
 * Time moves the verdict on its own (the schedule's `staleAt` passing with no
 * newer run), so `now` is state, refreshed by ONE timer to that instant. A new
 * run moves `staleAt` forward through the value itself, which re-arms it.
 */
export function useBackupHealth(): HealthStatus {
  const result = useLive(backupHealth);
  const [now, setNow] = useState(() => Date.now());
  const verdict = backupVerdict(result, now, useDateFormatter());
  const nextChangeAt = verdict.nextChangeAt;

  useEffect(() => {
    if (nextChangeAt === null) return;
    const wait = nextChangeAt - Date.now();
    // A monthly cron's `staleAt` can lie past the longest delay setTimeout
    // keeps (~24.8 days; past it the timer fires at once): wait the longest,
    // then re-arm from a fresh `now`.
    if (wait > MAX_TIMEOUT_MS) {
      const id = setTimeout(() => setNow(Date.now()), MAX_TIMEOUT_MS);
      return () => clearTimeout(id);
    }
    const id = setTimeout(
      // Never short of the instant waited for: a timer firing a millisecond
      // "early" by Date's reckoning would leave the verdict, and so this
      // effect's deps, unchanged, with no timer left to fire.
      () => setNow(Math.max(Date.now(), nextChangeAt)),
      Math.max(0, wait),
    );
    return () => clearTimeout(id);
  }, [nextChangeAt, now]);

  return verdict.status;
}
