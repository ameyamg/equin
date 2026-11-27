# Page readiness alert: "page not ready after N s" (D26 step 1)

Task: task-1795748911-mww3ke (decision D26, option A). Audit: task-1795742367-qhngox.

## Context

The `page-load` slow-op (`debug/slow-ops` collector) times navigation start → first
paint, before any data. It fired 2× in a week while 66 loads were really over 2 s.
The latency ledger already measures the real end-to-end time (every live read
mounted during the load answered + 400 ms quiet + a painted frame), stored per load
in `latency_ledger_interaction`, and nothing alerts on it.

## Main's distribution (7 days to 2026-11-27, page loads, visible tabs)

| | loads | p50 | p90 | > 3 s | > 5 s |
|---|---|---|---|---|---|
| people | 473 | 0.97 s | 3.0 s | 48 | 40 |
| automated | 862 | 1.5 s | 3.1 s | 93 | 23 |

Over 5 s, people: agents 37 (10 routes), files 2, deploy 1; home (220 loads),
prototypes (69), pages, mail, … none. Most of the agents tail is the refused-read
bug fixed in 76aead6809 (no load over 5 s since).

**N = 5 s.** Above p90 (3.0 s) so the ordinary spread of a healthy route never
fires, and the routes that are fine (home p90 1.1 s, prototypes 0.8 s) never cross
it; well under the 60 s cap, so a page that never finishes is caught at 5 s, not 60.
It stays the slow-op config's `pageLoadMs` (now default 5000, "Page ready
threshold"), editable in Settings → Config.

Old rule, same week: 3 page-load reports from people's tabs (deploy, agents,
prototypes; 1 occurrence each), ~45 occurrences from automated browsers.

## Design

1. **The alert fires from the ledger's own measure.** `interaction-tracker` arms
   one timer per page load at the budget. If the load is still waiting then (some
   counted read has no answer, tab never hidden), it calls `onNotReady` with the
   route PATTERN, the elapsed time and `pendingMountSnapshot().pendingKeys`. The
   collector emits it on `clientSlowOpSink` as `page-load` (`detail.censored`, the
   lower bound), `waitingFor`, and the boot trace (`clientBoot`, as before).
   Firing at the mark, not at the end, means a page that never finishes or a tab
   closed while waiting still reports, and names what it was waiting for at that
   moment. The ledger row keeps the full duration.
2. **Plumbing kept.** Same queue, endpoint, funnel, report kind and fingerprint
   (`slow-op:page-load:<route pattern>`, per route instead of per address). New
   optional `waitingFor` on the sink signal → client item → record input →
   report payload, drawn in the title and description. Automated browsers are
   marked as today (queue's `automated`).
3. **The first-paint timer is removed** from `SlowOpCollector`.
4. **"Ready" = reads on screen.** live-state gets an `OnScreen` context
   (default: on screen). `useResource` / `useResources` count a read as pending
   only while its nearest scope is on screen; a read in a scope that goes off
   screen stops holding the page, and holds it again if it comes back on screen
   while still waiting. Scopes are derived from what is drawn, never a per-call
   flag:
   - each app tab: on screen = the focused tab (the same flag that sets its
     `display`);
   - each transcript event row (jsonl-viewer `EventRow`, every loaded event is
     mounted, no windowing): an IntersectionObserver on the row's box
     (`useBoxOnScreen`, unknown counts as on screen until the first observation).
   - DataView rows are left to task-1795743274-oyeezx (a row's own reads held off
     screen), which can wrap rows in the same scope.

## Verification

- Unit: tracker fires `onNotReady` once at the budget with pending keys; not when
  settled, hidden, or for navigations. live-state: an off-screen scope's read is
  not counted, and is counted again when on screen.
- Build, open a slow page in the agent browser with a small `pageLoadMs`; see the
  report on the worktree's Reports with "waiting for".
- After landing: re-run the per-app query on `latency_ledger_interaction` and the
  reports table a week later.
