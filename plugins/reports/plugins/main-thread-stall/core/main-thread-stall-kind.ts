import { z } from "zod";
import { parseUrl } from "@plugins/packages/plugins/floor-compat/core";
import {
  dominantLayer,
  InteractionBreakdownSchema,
  interactionTargetKey,
  interactionTargetLabel,
  InteractionTargetSchema,
} from "./interaction-target";
import {
  heapNearCeiling,
  StallMemorySchema,
  StallStacksSchema,
} from "@plugins/reports/plugins/main-thread-stall/plugins/tab-evidence/core";

// The `main-thread-stall` report payload: a browser tab's main thread stopped
// answering for seconds. Filed by a live tab of the same origin on behalf of the
// stalled one (see ../CLAUDE.md), stored in the generic `data` jsonb column and
// validated on ingest by the server ReportKind.

// One script a long animation frame ran (LoAF `PerformanceScriptTiming`), the
// browser's own attribution of the frame's time.
export const StallFrameScriptSchema = z.object({
  invokerType: z.string(),
  invoker: z.string(),
  sourceURL: z.string(),
  sourceFunctionName: z.string(),
  sourceCharPosition: z.number(),
  // When the script began, in ms from its frame's start — what clips it to an
  // interaction's window. Null on frames recorded before it was kept.
  startMs: z.number().nullable().default(null),
  durationMs: z.number(),
  forcedStyleAndLayoutDurationMs: z.number(),
  pauseDurationMs: z.number(),
});
export type StallFrameScript = z.infer<typeof StallFrameScriptSchema>;

// One long animation frame (LoAF entry) on the wall clock: `startedAt` is epoch
// ms (its startTime through the clocks' offset at delivery — never
// timeOrigin + startTime, which lags after a device sleep), the offsets are ms
// from the frame's start.
export const StallFrameSchema = z.object({
  startedAt: z.number(),
  durationMs: z.number(),
  blockingDurationMs: z.number(),
  renderStartMs: z.number().nullable(),
  styleAndLayoutStartMs: z.number().nullable(),
  // The longest scripts of the frame, longest first (capped).
  scripts: z.array(StallFrameScriptSchema),
});
export type StallFrame = z.infer<typeof StallFrameSchema>;

// One task mark (primitives/perfs/task-marks): what the tab said it was about
// to run, posted to the watchdog BEFORE running it (and its end after) — so a
// tab that froze inside the task had already said which. `at` is the tab's
// Date.now() when it began.
export const TaskMarkSchema = z.object({
  at: z.number(),
  source: z.string(),
  what: z.string(),
  detail: z.string(),
});
export type TaskMark = z.infer<typeof TaskMarkSchema>;

// Where a tab was when it was last heard from: its id (sessionStorage — it
// survives a reload), app, route pattern (pane ids, never params) and page.
export const StallTabSchema = z.object({
  tabId: z.string(),
  app: z.string().nullable(),
  routePattern: z.string(),
  url: z.string(),
  visible: z.boolean(),
  focused: z.boolean(),
});
export type StallTab = z.infer<typeof StallTabSchema>;

// The user interaction a freeze started from: a click, tap or key press the tab
// had dispatched, whose next paint had not come yet when the thread went
// silent. Posted to the watchdog AT DISPATCH (before any handler runs), so a
// tab that froze inside the interaction had already said what was clicked.
export const StallInteractionSchema = z.object({
  // What was interacted with — the same identity a slow-interaction report
  // carries (no typed text, no user-data labels).
  target: InteractionTargetSchema,
  // The dispatched event (pointerdown, click, keydown), and its epoch ms.
  eventType: z.string(),
  startedAt: z.number(),
  // Where the time from the input to the stall's end went, from the long
  // frames the watchdog holds (all `other` when none arrived: gone / unknown).
  breakdown: InteractionBreakdownSchema,
  // The script that forced the most style/layout inside it, if any.
  forcedBy: z.string().nullable(),
});
export type StallInteraction = z.infer<typeof StallInteractionSchema>;

// The browser a stall happened in, coarsely: family and OS only — never the
// user agent, a version or anything else that narrows who it was (a website
// visitor's stall is filed by a stranger's browser). Read by the filing tab,
// which is always the same browser as the stalled one.
export const CLIENT_FAMILIES = [
  "chrome",
  "edge",
  "samsung",
  "opera",
  "firefox",
  "safari",
  "webview",
  "other",
  "unknown",
] as const;
export const CLIENT_OSES = [
  "android",
  "ios",
  "macos",
  "windows",
  "chromeos",
  "linux",
  "other",
  "unknown",
] as const;
export const StallClientSchema = z.object({
  family: z.enum(CLIENT_FAMILIES),
  os: z.enum(CLIENT_OSES),
});
export type StallClient = z.infer<typeof StallClientSchema>;

export const MainThreadStallPayloadSchema = StallTabSchema.extend({
  // Epoch ms. `endedAt` is when the thread answered again (recovered), when
  // the tab went away (gone), or the last instant it was seen still frozen
  // (unknown — the duration is then a lower bound).
  startedAt: z.number(),
  endedAt: z.number(),
  // The time the device was AWAKE inside [startedAt, endedAt) — what is
  // judged. The rest is `sleptMs`, split out, never counted as frozen.
  durationMs: z.number(),
  // Device sleep the watchdog measured inside the stall (its wall clock ran
  // on, its awake clock did not): endedAt − startedAt − durationMs. 0 on
  // reports filed before it was measured.
  sleptMs: z.number().default(0),
  // The silence's first word was the tab saying it is hidden (or
  // Page-Lifecycle-frozen), and no long frame proved its thread busy: the
  // browser most likely took the page out of view while its thread was not
  // running (suspended, paused), and it learned only on return. Recorded as
  // the `main-thread` slow-op only — never a report, never a bell. Null:
  // it came back in view, or a long frame covers it.
  returnedOutOfView: z.enum(["hidden", "frozen"]).nullable().default(null),
  // No JS ran on the main thread, and no frame spent the stall in style or
  // layout (`ranNoScript`, see `stallRanNoScript`): the thread was held
  // outside the page's work, not running a loop, whatever LoAF's entry point
  // says. Either the tab's own profile sampled the whole stall at its full
  // rate and found no JS — its tasks withheld by the browser, a nested native
  // wait (visitors' 180–1354 s "freezes" in `Ji (BODY.onanimationiteration)`
  // sampled 100% no JS, report-1795436129-p17ttz) — or the sampler thread
  // stopped too and one LoAF frame spanning the stall ran no script: the
  // renderer itself was not scheduled (a visitor's 11.2 s on equin.ai/, one
  // 11,227 ms frame with no script, its profile at 5.5% of its pace,
  // report-1795102621-jtqi2a). Set by the filing tab, which alone has the
  // profile; its own fingerprint row, and the summary names no function.
  // False: JS ran, or neither the profile nor LoAF could tell.
  ranNoScript: z.boolean().default(false),
  durationIsLowerBound: z.boolean(),
  // recovered: the tab answered again on its own. gone: it was reloaded,
  // closed or killed while frozen. unknown: the watchdog itself died with the
  // stall open (last tab closed, browser quit); filed on its next start.
  ended: z.enum(["recovered", "gone", "unknown"]),
  // worker: the out-of-thread watchdog saw it. in-tab: the fallback when the
  // browser has no SharedWorker (LoAF, plus a heartbeat drained next load).
  detector: z.enum(["worker", "in-tab"]),
  // Long frames (≥ 200 ms) the stalled tab ran inside the stall window, by
  // their own timestamps. 0 means one task never yielded (an endless
  // synchronous loop) or no entry arrived; more means the thread still ran
  // frames — a render storm rather than one blocked task.
  framesDuring: z.number(),
  // The LoAF entry covering the stall — the definitive attribution — when the
  // tab recovered and reported it. Null for gone / unknown stalls.
  stallFrame: StallFrameSchema.nullable(),
  // Those frames themselves (the longest, capped), oldest first: what ran
  // during the freeze when no single entry covers it. Absent on reports
  // filed before it existed.
  during: z.array(StallFrameSchema).default([]),
  // The long frames that ended within 10 s before the stall began
  // (breadcrumbs), oldest first. Never the freeze itself.
  frames: z.array(StallFrameSchema),
  // The tab's task marks from the 10 s before the stall to its end (the latest,
  // capped), oldest first. Absent on reports filed before marks existed.
  marks: z.array(TaskMarkSchema).default([]),
  // The marked task still OPEN (begun, never ended) when the stall opened: the
  // task the thread froze in (LoAF names only its entry point, and a socket's
  // port handler runs every frame). Null: it froze outside every marked task.
  frozenIn: TaskMarkSchema.nullable().default(null),
  // The user interaction the freeze started from (its handlers or the render
  // they led to never reached a paint), when one did. Absent on reports filed
  // before it existed, and on freezes no interaction started.
  interaction: StallInteractionSchema.nullable().default(null),
  // Other tabs that froze with it (same renderer process): victims, not causes.
  cohort: z.array(StallTabSchema),
  // The longest-running script of `stallFrame` — or, without one, summed over
  // `during` — as `function (invoker)`; null when unattributed. THE
  // attribution grain of the fingerprint.
  topFunction: z.string().nullable(),
  // The main-thread JS stacks sampled during the stall (see StallStacksSchema).
  // Evidence only: never part of the fingerprint or summary.
  stacks: StallStacksSchema.default({
    kind: "unavailable",
    reason: "filed before stall reports carried sampled stacks",
  }),
  // The stalled tab's JS heap around it (see StallMemorySchema). Evidence
  // only, like `stacks`.
  memory: StallMemorySchema.default({
    kind: "unavailable",
    reason: "filed before stall reports carried the heap",
  }),
  // The browser it happened in (see StallClientSchema). Evidence only, like
  // `stacks`: never part of the fingerprint or summary.
  client: StallClientSchema.default({ family: "unknown", os: "unknown" }),
});
export type MainThreadStallPayload = z.infer<
  typeof MainThreadStallPayloadSchema
>;

/**
 * A stall as the watchdog knows it: everything but `stacks` and `memory`,
 * which only the stalled tab can add (its profiler ran on its own thread, its
 * heap is its own) when it files, and
 * `client`, which the filing tab reads. It is also all the fingerprint and
 * summary may read — the same freeze stays one row whatever its sampled
 * stacks or browser were.
 */
export type MainThreadStallDraft = Omit<
  MainThreadStallPayload,
  "stacks" | "memory" | "client" | "ranNoScript"
>;

/**
 * What the fingerprint and summary read: the draft, plus the one coarse
 * verdict the filing tab derives from its profile (`ranNoScript`; absent on
 * the watchdog's own draft, which cannot know it) — never the stacks
 * themselves.
 */
export type MainThreadStallIdentity = MainThreadStallDraft &
  Partial<Pick<MainThreadStallPayload, "ranNoScript">>;

// How much of the stall the profile must have sampled (the sampler thread
// kept its pace: the renderer was neither suspended nor starved) — or, when
// its buffer filled first (a ~300 s buffer, and a frozen thread starts no
// next profiler), how long a stretch from the start; how much of that must
// have had no JS; how little of it any frame may have spent in style / layout
// (no-JS samples there are the page's own render work), and how much of it a
// script the profiler cannot see may have run.
const NO_SCRIPT = {
  MIN_SAMPLED: 0.9,
  // A sampler under its pace (it stopped with the thread: the renderer was
  // not scheduled) proves nothing alone: then the LoAF frame spanning the
  // stall must list no script at all, and the profile must still have
  // sampled this many intervals (no JS in ≥ MIN_NO_JS of them).
  MIN_UNDER_PACE_INTERVALS: 10,
  MIN_SAMPLED_TRUNCATED_MS: 60_000,
  MIN_NO_JS: 0.95,
  MAX_RENDER: 0.05,
  MAX_UNSEEN_SCRIPT: 0.05,
} as const;

/**
 * A LoAF script the page's profiler samples: one of the page's own origin.
 * Cross-origin script (without CORS), an extension's, or one with no URL
 * (eval, CDP-evaluated) samples as no JS — its silence on the profile proves
 * nothing.
 */
function profilerSees(sourceURL: string, pageUrl: string): boolean {
  if (!sourceURL) return false;
  const page = parseUrl(pageUrl);
  const src = parseUrl(sourceURL, pageUrl);
  return page !== null && src !== null && src.origin === page.origin;
}

/**
 * The profile kept its pace through the stall (it sampled ≥ 90% of it, or
 * ≥ 60 s from its start when its buffer filled first): the sampler thread was
 * scheduled, so a no-JS sample is the main thread's own state. Under its pace,
 * the sampler stopped with the thread — the renderer was not running.
 */
export function stallSamplerKeptPace(
  stacks: { sampledMs: number; truncated: boolean },
  durationMs: number,
): boolean {
  return stacks.truncated
    ? stacks.sampledMs >= NO_SCRIPT.MIN_SAMPLED_TRUNCATED_MS
    : stacks.sampledMs >= durationMs * NO_SCRIPT.MIN_SAMPLED;
}

/**
 * The stall ran no script (see `ranNoScript` on the payload): ≥ 95% of what
 * its profile sampled had no JS; its long frames spent ≤ 5% of it in style /
 * layout (their own pass or forced) and ≤ 5% in script the profiler cannot
 * see; the heap was not near its ceiling (GC); and the profile either
 * sampled ≥ 90% of it (or ≥ 60 s from its start, its buffer full) — or fell
 * under its pace (the sampler thread was not scheduled either), still
 * sampled ≥ 10 intervals, while the LoAF frame spanning the stall (the
 * watchdog takes the stall's span from it) and every frame during it listed
 * no script at all.
 *
 * LoAF lists every script entry ≥ 5 ms of a frame: a stall is one task that
 * never yielded (else the watchdog's ping would have run), so a frame
 * spanning it that lists none ran no script of 5 ms or more — a busy loop,
 * however starved its renderer, is one there and still files under its
 * function. A list is never judged by its sum: it keeps the longest five.
 */
export function stallRanNoScript(
  draft: MainThreadStallDraft,
  evidence: Pick<MainThreadStallPayload, "stacks" | "memory">,
): boolean {
  const st = evidence.stacks;
  const dur = draft.durationMs;
  if (st.kind !== "sampled" || dur <= 0) return false;
  if (st.noJsMs < st.sampledMs * NO_SCRIPT.MIN_NO_JS) return false;
  const m = evidence.memory;
  if (m.kind === "measured" && heapNearCeiling(m)) return false;
  const frames = [
    ...(draft.stallFrame ? [draft.stallFrame] : []),
    ...draft.during,
  ];
  let renderMs = 0;
  let scripts = 0;
  let unseenMs = 0;
  for (const f of frames) {
    if (f.styleAndLayoutStartMs !== null)
      renderMs += Math.max(0, f.durationMs - f.styleAndLayoutStartMs);
    for (const x of f.scripts) {
      renderMs += x.forcedStyleAndLayoutDurationMs;
      scripts++;
      if (!profilerSees(x.sourceURL, draft.url)) unseenMs += x.durationMs;
    }
  }
  if (
    renderMs > dur * NO_SCRIPT.MAX_RENDER ||
    unseenMs > dur * NO_SCRIPT.MAX_UNSEEN_SCRIPT
  )
    return false;
  if (stallSamplerKeptPace(st, dur)) return true;
  // The sampler fell under its pace: LoAF can still say no script ran — not
  // past a full buffer, whose tail no profile saw.
  return (
    !st.truncated &&
    draft.stallFrame !== null &&
    scripts === 0 &&
    st.sampledMs >= st.sampleIntervalMs * NO_SCRIPT.MIN_UNDER_PACE_INTERVALS
  );
}

/**
 * A freeze a user interaction started: the interaction's target alone — the
 * same control freezing again is the same row, on whatever screen, through
 * whichever function. Otherwise app + route pattern + the top attributed
 * function (or `unattributed`), then the frozen task's mark (`source:what`)
 * when it set one — LoAF's entry point alone lumps every frame a socket
 * handler runs together. No ids, durations or end kinds: the same freeze is
 * one row whose `count` grows, and its `data` is the newest sighting.
 */
export function mainThreadStallFingerprint(
  data: MainThreadStallIdentity,
): string {
  if (data.interaction)
    return `main-thread-stall:interaction:${interactionTargetKey(data.interaction.target)}`;
  const task = data.frozenIn
    ? `|${data.frozenIn.source}:${data.frozenIn.what}`
    : "";
  // No JS ran: LoAF's entry point did not spend the time, so it is not the
  // row's identity.
  const who = data.ranNoScript
    ? "no-script"
    : (data.topFunction ?? "unattributed");
  return `main-thread-stall:${data.app ?? "-"}|${data.routePattern}|${who}${task}`;
}

/** The one-line summary used as the report message and the task title stem. */
export function mainThreadStallSummary(data: MainThreadStallIdentity): string {
  const secs = (data.durationMs / 1000).toFixed(1);
  const at = `${data.app ?? "?"} ${data.routePattern}`;
  const len = `${data.durationIsLowerBound ? "≥" : ""}${secs}s (${data.ended})`;
  const task = data.frozenIn
    ? ` in ${data.frozenIn.source} ${data.frozenIn.what}`
    : "";
  // Not a busy thread: say so, and name no function (none ran). A click's
  // freeze keeps its own form (its row is the click's, whatever ran).
  if (data.ranNoScript && !data.interaction)
    return `Main thread unresponsive ${len}, no JS ran — ${at} — held outside script (browser-withheld, a native wait, or the renderer not scheduled)${task}`;
  const who = data.topFunction ?? "unattributed";
  const frozen = `Main thread frozen ${len}`;
  const i = data.interaction;
  if (i) {
    const top = dominantLayer(i.breakdown);
    const fn =
      i.forcedBy && top.layer === "forced style/layout"
        ? i.forcedBy
        : data.ranNoScript
          ? null
          : data.topFunction;
    return `${frozen} after ${interactionTargetLabel(i.target)} — ${at} — ${top.layer} ${top.ms} ms${fn ? ` (${fn})` : ""}`;
  }
  return `${frozen} — ${at} — ${who}${task}`;
}
