import {
  asPerfMs,
  perfToEpoch,
} from "@plugins/primitives/plugins/perfs/plugins/page-clock/core";
import {
  pendingMountSnapshot,
  subscribePendingMounts,
} from "@plugins/network/plugins/live/plugins/live-state/web";
import {
  currentRoutePath,
  peekRoutePattern,
} from "@plugins/primitives/plugins/pane/web";
import { hashHex } from "@plugins/packages/plugins/string-hash/core";
import { clientLog } from "@plugins/primitives/plugins/log-channels/web";
import type { Interaction } from "../../core";
import {
  beginUserWait,
  type UserWait,
} from "@plugins/debug/plugins/slow-ops/plugins/sink/core";

// When is what the user just opened "on screen"?
//
// An interaction (a page load, or a click that opens another screen) ends when
// every list that started loading during it has its data, and that stays true for
// a short quiet window. The quiet window exists because the new screen's components
// mount a little after the click — its code may load lazily — so "nothing is
// loading" at the instant of the click means nothing yet. The DURATION recorded is
// up to the moment the last list got its data (plus one painted frame), not up to
// the end of the quiet window.

const QUIET_MS = 400;

/** A page load still waiting at its ready budget: what it waits for. */
export interface NotReady {
  /** The route pattern (`peekRoutePattern`), never the address bar. */
  route: string;
  /** Navigation start → now: the budget, give or take a timer's lateness. */
  elapsedMs: number;
  /** The budget it was judged against. */
  budgetMs: number;
  /**
   * What held the page: still waiting — the reads on screen with no answer
   * yet, most waited first; done — the read that answered last.
   */
  waitingFor: string[];
  /**
   * The load finished (past its budget) before it was told: a load that was
   * quiet at the budget — its reads not mounted yet (a slow bundle, lazy app
   * code) — and then took longer. `elapsedMs` is then its real duration.
   */
  done: boolean;
  /** The user wait this load is (sink's `beginUserWait`): its report's evidence key. */
  wait: { waitId: string; startedAt: number };
}
// A screen still waiting after this long is recorded as "at least this long".
const CAP_MS = 60_000;

interface Active {
  kind: Interaction["kind"];
  /** `performance.now()` at the start (0 for the page load: navigation start). */
  startMs: number;
  startedTotalAtStart: number;
  hidden: boolean;
  /** `performance.now()` at which the count last reached zero, if it is zero now. */
  settledAtMs: number | null;
  quietTimer: ReturnType<typeof setTimeout> | null;
  capTimer: ReturnType<typeof setTimeout>;
  /** The ready-budget check, armed once per page load until it runs. */
  readyTimer: ReturnType<typeof setTimeout> | null;
  /** `onNotReady` was told about this load (at most once). */
  told: boolean;
  /** The ready budget this page load is judged against (`null`: none). */
  budgetMs: number | null;
  /**
   * A page load's user wait (sink's `beginUserWait`): per-op findings while it
   * is pending are held as its evidence. Ended with the load, cancelled when
   * the tab was hidden in it (no person waited; it never alerts). Null for an
   * in-app navigation, which has no end-to-end alert to carry evidence.
   */
  wait: UserWait | null;
}

let active: Active | null = null;
let report: ((interaction: Interaction) => void) | null = null;
/** What a page load still waiting at its budget is handed to. */
export interface ReadyBudget {
  /** The budget, ms from navigation start — read as each page load begins. */
  budgetMs: () => number;
  onNotReady: (info: NotReady) => void;
}

let ready: ReadyBudget | null = null;

function finish(a: Active, endMs: number, censored: boolean): void {
  if (active !== a) return;
  active = null;
  clearTimers(a);
  if (a.wait !== null) {
    if (a.hidden) a.wait.cancel();
    else a.wait.end();
  }
  const snap = pendingMountSnapshot();
  // A load quiet at its budget (nothing mounted yet) that then took longer
  // was never told at the budget: tell it now, with what answered last.
  // Not a load cut short (censored): a reload or a navigation left it, and
  // its row says "at least"; one still waiting was told at the budget.
  const durationMs = Math.max(0, endMs - a.startMs);
  if (
    a.kind === "page-load" &&
    !a.told &&
    !censored &&
    !a.hidden &&
    a.budgetMs !== null &&
    durationMs >= a.budgetMs
  ) {
    a.told = true;
    ready?.onNotReady({
      route: peekRoutePattern(),
      elapsedMs: durationMs,
      budgetMs: a.budgetMs,
      waitingFor: snap.lastReleasedKey === null ? [] : [snap.lastReleasedKey],
      done: true,
      ...waitOf(a),
    });
  }
  // One line per page load / navigation — a handful a day. When a screen never
  // finished, the line names the lists it was still waiting for.
  clientLog(
    "latency-ledger",
    `${a.kind} ${Math.round(Math.max(0, endMs - a.startMs))}ms route=${currentRoutePath()} lists=${snap.startedTotal - a.startedTotalAtStart}` +
      (censored
        ? ` CENSORED waiting-for=[${snap.pendingKeys.join(", ")}]`
        : "") +
      (a.hidden ? " hidden" : ""),
  );
  report?.({
    kind: a.kind,
    occurredAt: Date.now(),
    // The pattern, never the address bar: latency aggregates per screen, and
    // a URL carrying a DataView filter can be any length (the log line above
    // keeps the full path for whoever reads this tab's log).
    route: peekRoutePattern(),
    placeKey: hashHex(currentRoutePath()),
    durationMs: Math.max(0, endMs - a.startMs),
    hidden: a.hidden,
    censored,
    resourceCount: snap.startedTotal - a.startedTotalAtStart,
    lastResourceKey: snap.lastReleasedKey,
  });
}

// A page load always has its wait (`begin`); only a load is ever told.
function waitOf(a: Active): { wait: NotReady["wait"] } {
  if (a.wait === null)
    throw new Error("latency-ledger: a page load without its user wait");
  return { wait: { waitId: a.wait.id, startedAt: a.wait.startedAt } };
}

function clearTimers(a: Active): void {
  if (a.quietTimer !== null) clearTimeout(a.quietTimer);
  if (a.readyTimer !== null) clearTimeout(a.readyTimer);
  clearTimeout(a.capTimer);
}

// The page load's ready budget: once, at the budget, a load still waiting for
// a read on screen (the count not at zero — a load settled and only sitting
// out its quiet window is ready) is handed to `onNotReady` with what it waits
// for. At the budget, not at the end: a page that never finishes, or a tab
// closed while it waits, is told all the same, and what it waited for is
// named while it still waits. A tab hidden at any point measures the browser
// (its timers throttled), so it is never told.
function armReady(a: Active): void {
  if (a.budgetMs === null) return;
  const budget = a.budgetMs;
  a.readyTimer = setTimeout(
    () => {
      a.readyTimer = null;
      if (active !== a || a.settledAtMs !== null) return;
      if (a.hidden || document.visibilityState === "hidden") return;
      a.told = true;
      ready?.onNotReady({
        route: peekRoutePattern(),
        elapsedMs: performance.now() - a.startMs,
        budgetMs: budget,
        waitingFor: pendingMountSnapshot().pendingKeys,
        done: false,
        ...waitOf(a),
      });
    },
    // Rounded up: a timer may fire up to ~1 ms early against
    // `performance.now()`, and a load told under its budget is dropped.
    Math.max(0, Math.ceil(budget - (performance.now() - a.startMs)) + 1),
  );
}

function armQuiet(a: Active): void {
  if (a.quietTimer !== null) clearTimeout(a.quietTimer);
  a.quietTimer = setTimeout(() => {
    a.quietTimer = null;
    if (a.settledAtMs !== null) finish(a, a.settledAtMs, false);
  }, QUIET_MS);
}

function onCount(pending: number): void {
  const a = active;
  if (a === null) return;
  if (pending > 0) {
    // Something started loading again: not settled after all.
    a.settledAtMs = null;
    if (a.quietTimer !== null) {
      clearTimeout(a.quietTimer);
      a.quietTimer = null;
    }
    return;
  }
  if (a.settledAtMs !== null) return;
  // Data is in the cache now; it is on screen one frame later. A hidden tab gets
  // no animation frame at all (that is how a 26-minute "page load" was once
  // recorded), so there the cache time is the end.
  a.settledAtMs = performance.now();
  if (document.visibilityState === "visible") {
    requestAnimationFrame(() => {
      if (active === a && a.settledAtMs !== null)
        a.settledAtMs = performance.now();
    });
  }
  armQuiet(a);
}

function begin(kind: Interaction["kind"], startMs: number): void {
  // A new interaction cuts the previous one short. It is recorded, as "at least
  // this long": a user who leaves a slow screen because it is slow must not make
  // that screen's sample disappear.
  if (active !== null) finish(active, performance.now(), true);
  const snap = pendingMountSnapshot();
  const a: Active = {
    kind,
    startMs,
    startedTotalAtStart: kind === "page-load" ? 0 : snap.startedTotal,
    hidden: document.visibilityState === "hidden",
    settledAtMs: null,
    quietTimer: null,
    capTimer: setTimeout(() => finish(a, performance.now(), true), CAP_MS),
    readyTimer: null,
    told: false,
    budgetMs: kind === "page-load" && ready !== null ? ready.budgetMs() : null,
    wait:
      kind === "page-load"
        ? beginUserWait("page-load", perfToEpoch(asPerfMs(startMs)))
        : null,
  };
  active = a;
  armReady(a);
  onCount(snap.pending);
}

/**
 * The page is going away: record the interaction still in flight as "at least
 * this long" (censored). Without it a page that unloads before its lists
 * settle — every reload of a tab reloading faster than its page loads — would
 * leave no row at all, and a reload loop would be invisible exactly when it is
 * at its worst.
 */
export function cutActiveInteraction(): void {
  if (active !== null) finish(active, performance.now(), true);
}

/**
 * Start tracking. `onInteraction` receives every finished page load and
 * navigation; `readyBudget` a page load still waiting at its budget.
 * Returns the teardown.
 */
export function startInteractionTracking(
  onInteraction: (interaction: Interaction) => void,
  readyBudget?: ReadyBudget,
): () => void {
  report = onInteraction;
  ready = readyBudget ?? null;
  const unsubscribe = subscribePendingMounts(onCount);
  const onVisibility = (): void => {
    if (active !== null && document.visibilityState === "hidden")
      active.hidden = true;
  };
  const onNavigate = (): void => begin("navigate", performance.now());
  document.addEventListener("visibilitychange", onVisibility);
  // `shell:navigate` is every programmatic in-app navigation; `popstate` is the
  // browser's back and forward buttons.
  window.addEventListener("shell:navigate", onNavigate);
  window.addEventListener("popstate", onNavigate);
  // The page load itself: `performance.now()` counts from navigation start.
  begin("page-load", 0);
  return () => {
    unsubscribe();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("shell:navigate", onNavigate);
    window.removeEventListener("popstate", onNavigate);
    if (active !== null) {
      clearTimers(active);
      active.wait?.cancel();
      active = null;
    }
    report = null;
    ready = null;
  };
}
