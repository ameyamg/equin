import type { ReplaySettled } from "@plugins/framework/plugins/server-core/core";
import {
  MAX_REPORT_FINDINGS,
  type FindingSource,
  type ReportFinding,
} from "../../core";

// Per-op findings as evidence of end-to-end reports (D26 step 3,
// research/2026-11-27-debug-per-op-findings-as-evidence.md).
//
// Every per-op monitor — slow-ops' spans and client items, op-rate's boot
// window, boot-budget's hooks — asks ONE question before it files: was a
// person waiting end to end while this happened? Yes → the finding files no
// report of its own; it is evidence, attached to the end-to-end report of that
// wait (`page-load` "not ready", `live-again` "not live again") when one
// fires, and only recorded when the wait ended inside its budget. No → it is
// background work nobody waited on, and files as before.
//
// Who knows a person waited:
// - the TAB, for its own items: the queue stamps `during` (sink's
//   `userWaitDuring`) — the tab's page load or recovery was pending;
// - the SERVER, for its own findings: its restart replay — from ready (the
//   gateway swaps this backend in and every tab's socket drops) to the replay
//   settled, when any tab replayed (`whenReplaySettled`: not `no-replay`).
//   Every tab was waiting to be live again through it.
//
// Cost reports (op-time, op-rate's steady and hour windows, …) never ask:
// sustained or wasted work is worth a report whoever waited.

/** One per-op finding, as its monitor would have filed it. */
export interface Finding {
  source: FindingSource;
  /** The one-line message its report would have carried. */
  what: string;
  /** Its own time (ms); absent for a count. */
  ms?: number;
  /** Wall clock (epoch ms). */
  startMs: number;
  endMs: number;
  /** A tab's item: the user wait it happened during (`during`). */
  during?: string;
  /**
   * Background work by its own kind (a `bg` pass, a `job` run, or an op one of
   * them issued): nobody waits on it, so it files whenever it overlaps — an
   * 11-minute stream that merely spans a restart is not the restart's.
   */
  background?: true;
}

/** Where a finding goes. */
export type FindingVerdict =
  { kind: "evidence"; via: "tab" | "restart" } | { kind: "standalone" };

// ── The server's restart window ───────────────────────────────────────

/** This process's restart replay, as wall-clock bounds. */
export type RestartWindow =
  | { kind: "not-ready" }
  | { kind: "pending"; readyAt: number; settled: Promise<RestartSettled> }
  | RestartSettled;

export type RestartSettled =
  | { kind: "no-replay"; readyAt: number }
  | { kind: "replayed"; readyAt: number; endAt: number };

/** What the window is read from: the profiler's ready instant and the replay. */
export interface RestartSource {
  /** Wall-clock instant of `markServerReady`, or null before it (or never: a host that does not serve). */
  readyAt: () => number | null;
  /** The replay's outcome (`whenReplaySettled`) — only called once ready. */
  replaySettled: () => Promise<ReplaySettled>;
}

export function createRestartWindow(src: RestartSource): () => RestartWindow {
  let state: RestartWindow = { kind: "not-ready" };
  return () => {
    if (state.kind !== "not-ready") return state;
    const readyAt = src.readyAt();
    if (readyAt === null) return state;
    const settled = src.replaySettled().then((r): RestartSettled => {
      const s: RestartSettled =
        r.kind === "no-replay"
          ? { kind: "no-replay", readyAt }
          : { kind: "replayed", readyAt, endAt: readyAt + r.afterMs };
      state = s;
      return s;
    });
    state = { kind: "pending", readyAt, settled };
    return state;
  };
}

/**
 * Judge one finding. A tab's item during its wait is evidence at once; a
 * server finding is judged against the restart replay — awaited while it is
 * still unsettled (≤ its herd wait plus ceiling, ~33 s), since until then
 * nobody can say whether any tab replayed.
 */
export async function judgeFinding(
  f: Finding,
  restart: () => RestartWindow,
): Promise<FindingVerdict> {
  if (f.during !== undefined) return { kind: "evidence", via: "tab" };
  if (f.background === true) return { kind: "standalone" };
  let w = restart();
  // Before ready the predecessor still serves every tab: nobody waits on this
  // process yet (a slow `onReadyBlocking` hook delays the deploy, not a tab).
  if (w.kind === "not-ready") return { kind: "standalone" };
  if (f.endMs < w.readyAt) return { kind: "standalone" };
  if (w.kind === "pending") w = await w.settled;
  if (w.kind === "no-replay") return { kind: "standalone" };
  return f.startMs <= w.endAt
    ? { kind: "evidence", via: "restart" }
    : { kind: "standalone" };
}

// ── The ring: every finding of the last minutes, held or filed ─────────

interface Ringed {
  finding: Finding;
  verdict: FindingVerdict;
  /** Its own report, when it filed one. */
  reportId?: string;
}

/** An end-to-end report still taking evidence. */
export interface OpenEndToEnd {
  reportId: string;
  occurredAt: number;
  message: string;
  data: Record<string, unknown>;
  waitId: string;
  /** Wall clock: when the wait began. */
  startedAt: number;
}

const RING_KEEP_MS = 15 * 60_000;
const RING_MAX = 2_000;
/**
 * A wait is matched for this long after its report: op-rate judges a boot
 * window at its first tick, or its second when that came within 3 min of the
 * start — up to ~8 min after the restart.
 */
export const OPEN_KEEP_MS = 10 * 60_000;
/**
 * How long past an end-to-end report's filing a finding HELD in the restart
 * replay is still its evidence: the ledger's cap — a wait filed at its budget
 * may go on to it, and the server cannot see when it ended. A finding that
 * filed on its own is listed only up to the filing (it was surely inside).
 */
export const WINDOW_PAST_FILING_MS = 60_000;

export interface FindingsBook {
  /** Note a finding and where it went (its report id when filed). */
  note(f: Finding, verdict: FindingVerdict, reportId?: string): void;
  /** The evidence for a wait filed at `filedAt`: its tab's items and the server's in its window. */
  evidenceFor(
    waitId: string,
    startedAt: number,
    filedAt: number,
  ): { total: number; items: ReportFinding[] };
  /** An end-to-end report filed: later matching findings restate it. */
  open(e: OpenEndToEnd): void;
}

/**
 * The per-process evidence book. `restate` is handed an open report whose
 * evidence grew (coalesced: at most one per report per `restateDelayMs`).
 */
export function createFindingsBook(deps: {
  now: () => number;
  restate: (
    e: OpenEndToEnd,
    findings: { total: number; items: ReportFinding[] },
  ) => void;
  restateDelayMs?: number;
}): FindingsBook {
  const ring: Ringed[] = [];
  const opens: OpenEndToEnd[] = [];
  const pendingRestate = new Map<OpenEndToEnd, ReturnType<typeof setTimeout>>();
  const delay = deps.restateDelayMs ?? 2_000;
  /** How many findings each open report already says (filed or restated). */
  const shown = new WeakMap<OpenEndToEnd, number>();

  function prune(): void {
    const now = deps.now();
    while (
      ring.length > 0 &&
      (ring.length > RING_MAX || now - ring[0]!.finding.endMs > RING_KEEP_MS)
    )
      ring.shift();
    for (let i = opens.length - 1; i >= 0; i--)
      if (now - opens[i]!.occurredAt > OPEN_KEEP_MS) opens.splice(i, 1);
  }

  function matches(
    r: Ringed,
    waitId: string,
    startedAt: number,
    filedAt: number,
  ): ReportFinding["via"] | null {
    if (r.finding.during !== undefined)
      return r.finding.during === waitId ? "tab" : null;
    const held = r.verdict.kind === "evidence";
    const windowEnd = held ? filedAt + WINDOW_PAST_FILING_MS : filedAt;
    const overlaps =
      r.finding.startMs <= windowEnd && r.finding.endMs >= startedAt;
    if (!overlaps) return null;
    return r.verdict.kind === "evidence" ? r.verdict.via : "window";
  }

  function evidenceFor(
    waitId: string,
    startedAt: number,
    filedAt: number,
  ): { total: number; items: ReportFinding[] } {
    prune();
    const all: ReportFinding[] = [];
    for (const r of ring) {
      const via = matches(r, waitId, startedAt, filedAt);
      if (via === null) continue;
      all.push({
        source: r.finding.source,
        what: r.finding.what.slice(0, 300),
        ...(r.finding.ms !== undefined && { ms: Math.round(r.finding.ms) }),
        startMs: r.finding.startMs,
        endMs: r.finding.endMs,
        via,
        ...(r.reportId !== undefined && { reportId: r.reportId }),
      });
    }
    // Largest first; a count (no ms) after every timed one.
    all.sort((a, b) => (b.ms ?? -1) - (a.ms ?? -1));
    return { total: all.length, items: all.slice(0, MAX_REPORT_FINDINGS) };
  }

  function scheduleRestate(e: OpenEndToEnd): void {
    if (pendingRestate.has(e)) return;
    const t = setTimeout(() => {
      pendingRestate.delete(e);
      const findings = evidenceFor(e.waitId, e.startedAt, e.occurredAt);
      // Never restated with less: the ring may have aged out (or, past its
      // cap, dropped) findings the report already names.
      const said = shown.get(e) ?? 0;
      if (findings.total <= said) return;
      shown.set(e, findings.total);
      deps.restate(e, findings);
    }, delay);
    (t as { unref?: () => void }).unref?.();
    pendingRestate.set(e, t);
  }

  return {
    note(finding, verdict, reportId) {
      const r: Ringed = {
        finding,
        verdict,
        ...(reportId !== undefined && { reportId }),
      };
      ring.push(r);
      prune();
      for (const e of opens)
        if (matches(r, e.waitId, e.startedAt, e.occurredAt) !== null)
          scheduleRestate(e);
    },
    evidenceFor,
    open(e) {
      prune();
      const data = e.data as { findings?: { total?: number } };
      shown.set(e, data.findings?.total ?? 0);
      opens.push(e);
    },
  };
}
