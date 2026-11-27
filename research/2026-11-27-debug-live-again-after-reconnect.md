# Restart recovery: "tab not live again after N s" (D26 step 2)

Task: task-1795748919-k120x1 (decision D26, option A). Step 1:
`research/2026-11-27-debug-page-ready-alert.md`. Audit: task-1795742367-qhngox.

## Context

After a server restart (or any socket drop) a tab reconnects and replays its
subscriptions in one `sub-batch`, while it keeps showing cached values that
may be stale. Nothing measured that time or said so on screen. The audit
rebuilt it from logs: current again at p50 3.1 s, p90 7.0 s, p99 65 s after the
socket closed; a typical /agents tab ~9 s. Decision D25 (hold the replay until
the boot hooks finish) will be judged by this measure.

## Design

1. **live-state measures one recovery per socket** (`web/internal/recovery-tracker.ts`,
   owned by `NotificationsClient`):
   - starts when a socket that had been open leaves `open` (status bus);
   - on the next open's replay, the replayed set is every sub with a reader
     (`refcount > 0`; keep-alive subs are not on screen) and the request id
     each entry was sent under;
   - a sub leaves the set when the answer to that request lands
     (`noteAnswered`: `sub-ack`, `up-to-date` incl. the batch, `sub-error`),
     when it is resent (the new id replaces the old) or released;
   - ends when the set is empty. A second drop mid-replay keeps the first
     drop's start and waits for the next replay.
   - Sleep: the tracker keeps the clock offset (`page-clock`'s
     `clockOffset`, wall − performance) of the last frame heard before the
     drop; the offset grown since is the time the machine slept between the
     last frame and now — a recovery whose span (or the silence just before
     its drop: a wake-caused drop) holds a sleep is marked `sleptMs`.
   - API: `subscribeRecovery(listener)` (start / replaying / end events),
     `getRecoveries()` (snapshot, stable identity), `recoveryPendingKeys(kind)`
     (`key×n`, most first), `useLiveRecoveries()` hook.
2. **The ledger records it** as a new client metric `reconnect` ("Live
   again after a reconnect"): awake time (performance clock) from drop to the
   last replayed answer. Excluded from percentiles when the tab was hidden in
   the span or the machine slept (> 1 s); censored at 60 s like interactions.
3. **Alert on the same path as step 1**: at slow-ops' new `liveAgainMs`
   (default 10 s — above the audit's p90 7.0 s, catching the p99 65 s tail)
   a recovery still pending, in a visible tab, with no sleep, files one
   `live-again` slow-op through `clientSlowOpSink`: operation = route
   pattern, `censored`, `waitingFor` = the replayed reads still unanswered
   (or "socket still reconnecting"). Title: "live-again /agents/… still not
   done after 10000ms — waiting for …".
4. **Visible state**: the health report's Connection row says "Catching up
   after reconnecting — N live reads replayed" (`info`, transitioning: the
   dot pulses blue) while a replay is pending, instead of "Server connected"
   over stale data.

## Verification

- Unit: tracker (start, replay set, answered/resent/released, end, re-drop,
  sleep), connection-health row, ledger collector (sample, exclusion, budget
  report), report message.
- Build; restart the worktree backend with a tab open; see the row and the
  ledger sample; with a small `liveAgainMs`, the report on Reports.
