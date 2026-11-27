import { z } from "zod";
import { TabEvidenceSchema } from "@plugins/reports/plugins/main-thread-stall/plugins/tab-evidence/core";

/** What a held per-op finding came from: the three per-op monitors. */
export const FINDING_SOURCES = ["slow-op", "op-rate", "boot-budget"] as const;
export type FindingSource = (typeof FINDING_SOURCES)[number];

/** How many findings an end-to-end report names (the largest first). */
export const MAX_REPORT_FINDINGS = 20;

/**
 * One per-op finding seen while a person waited end to end (D26 step 3): the
 * evidence an end-to-end report (`page-load`, `live-again`) carries instead of
 * the finding filing a report of its own.
 */
export const ReportFindingSchema = z.object({
  source: z.enum(FINDING_SOURCES),
  /** The finding's own one-line message (as its report would have said it). */
  what: z.string(),
  /** Its own time, ms — absent for a count (an op-rate burst). */
  ms: z.number().optional(),
  /** Wall-clock start and end (epoch ms). */
  startMs: z.number(),
  endMs: z.number(),
  /** `tab`: the tab's own item during this wait; `restart`: the server's, in its restart replay; `window`: a server finding inside the wait's window. */
  via: z.enum(["tab", "restart", "window"]),
  /** The finding's own report, when it was filed on its own (a server finding outside a restart). */
  reportId: z.string().optional(),
});
export type ReportFinding = z.infer<typeof ReportFindingSchema>;

// The jsonb payload for the "slow-op" report. The report fingerprint keys on
// (operationKind, operation), so each distinct slow op owns its own report; the
// payload carries that op's identity plus its latest tripping duration —
// fingerprint, task title/description, and message all read from it. The full
// ranked breakdown (totals, max, caller attribution) lives in the slow_ops store
// / Debug → Slow Ops, which each report points into.
export const SlowOpReportPayloadSchema = z.object({
  operationKind: z.string(),
  operation: z.string(),
  durationMs: z.number(),
  // The operation's own time — what was judged against `thresholdMs` (see
  // "Own time" in CLAUDE.md). Absent on reports filed before it existed, which
  // judged the wall `durationMs`.
  ownMs: z.number().optional(),
  thresholdMs: z.number(),
  // Optional, backward-compatible cold-start attribution (element signal only).
  // Stored in the report's jsonb `data`, so no migration. When present and true,
  // renderTask/renderDescription append that the measured duration was
  // transport bring-up (time-to-first-data), not this resource's own compute —
  // pointing the investigation at transport/boot readiness, not the resource.
  transportColdStart: z.boolean().optional(),
  // Pre-`waits` spelling of the cold-start wait, kept so reports filed before
  // the move still parse and render. New reports carry it as
  // `waits["notifications-transport"]`.
  transportWaitMs: z.number().optional(),
  // The tripping occurrence's per-layer split (layer → ms): a server span's gate
  // waits, a client latency signal's phases, an element's transport bring-up.
  // The description names its largest layer.
  waits: z.record(z.string(), z.number()).optional(),
  // The durable trace captured for the trip that filed this report (when the
  // engine admitted one). Stored in the jsonb `data` (no migration) so the
  // slow-op KindView / renderTask can deep-link the coherent-instant evidence.
  traceId: z.string().optional(),
  // The trip was seen by a browser under automation (`navigator.webdriver`:
  // the agent browser, an e2e run). A mark, never a filter — that browser runs
  // the code a visitor does; the report row's userAgent names it. Absent: a
  // person's browser, a server span, or a report filed before the mark.
  automated: z.literal(true).optional(),
  // What the tab's own thread ran inside this trip — its sampled JS stacks and
  // heap around it — when the producer had them (a `main-thread` long frame
  // the tab lived through). LoAF names only a frame's entry point; this is
  // what ran beneath it. Evidence only: never the fingerprint or message.
  evidence: TabEvidenceSchema.optional(),
  // What the op was still waiting on when it was filed — a page not ready
  // yet: the live reads it waited for (resource keys, `×n` for n readers),
  // most waited first. Named in the title and description.
  waitingFor: z.array(z.string()).optional(),
  // The duration is a lower bound: the op had not finished when filed (a page
  // still not ready at its budget).
  censored: z.literal(true).optional(),
  // Present when this op tripped beside others of its kind in one batch — one
  // incident, which rang the bell once while each op kept its own report:
  // `count` is every distinct op of the batch, `operations` its slowest few
  // (`BURST_NAMED_CAP`). A row filed before that (operation `burst`, the
  // retired `slow-op:<kind>:burst` fingerprint) stood for the whole batch,
  // carrying its slowest op's numbers.
  burst: z
    .object({
      count: z.number(),
      operations: z.array(
        z.object({ operation: z.string(), ownMs: z.number() }),
      ),
    })
    .optional(),
  // An end-to-end report only (`page-load`, `live-again`): the per-op findings
  // seen while the person waited — slow ops, op-rate bursts, boot-budget
  // overruns, waits — which file no report of their own. `total` is every one
  // held, `items` the largest (`MAX_REPORT_FINDINGS`). Restated as late ones
  // arrive (op-rate and boot-budget judge on their own ticks).
  // When the wait this end-to-end report measures began (wall clock, epoch
  // ms): the findings' times are read from it.
  startedAtMs: z.number().optional(),
  findings: z
    .object({
      total: z.number(),
      items: z.array(ReportFindingSchema).max(MAX_REPORT_FINDINGS),
    })
    .optional(),
});
export type SlowOpReportPayload = z.infer<typeof SlowOpReportPayloadSchema>;

type BurstPayload = SlowOpReportPayload & {
  burst: NonNullable<SlowOpReportPayload["burst"]>;
};

/**
 * A row of the retired `slow-op:<kind>:burst` fingerprint: one report stood for
 * a whole batch, carrying its slowest op's numbers. Kept so those rows still
 * render; nothing files one now (each op files its own, the batch rings once).
 */
export function isLegacyBurstReport(d: SlowOpReportPayload): d is BurstPayload {
  return d.operation === "burst" && d.burst !== undefined;
}
