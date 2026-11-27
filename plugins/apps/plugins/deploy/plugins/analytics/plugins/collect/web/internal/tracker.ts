import {
  IDLE_AFTER_MS,
  MAX_ENGAGED_MS,
  appendGap,
  firstByteOf,
  loadMs,
  pagePathOf,
  type CollectBody,
  type CollectResponse,
  type EngagementBody,
  type Gap,
  type GapKind,
  type LoadTiming,
  type Viewport,
} from "../../core";
import type { FirstByteSplit } from "@plugins/primitives/plugins/perfs/plugins/boot-trace/core";
import type { LandingSource } from "./landing";

/** What became of one send: answered, or lost between the page and the site. */
export type CollectSent =
  { delivered: true; response: CollectResponse } | { delivered: false };

/**
 * Everything the tracker reads from or does to the outside world, injected so
 * the logic below is plain and testable.
 */
export interface TrackerDeps {
  /** `location.host` of the page. */
  host: string;
  /** The landing URL's source, sent with the first pageview only. */
  landing: LandingSource;
  /**
   * Whether this browser is marked as the site owner's (`owner-mark.ts`), read
   * on every pageview and event so a mark made mid-visit counts from then on.
   */
  isOwner: () => boolean;
  /**
   * The browser's consent key (`consent.ts`), or undefined until the visitor
   * accepts — read on every pageview and event, so an answer given mid-visit
   * counts from the next hit on.
   */
  consentKey: () => string | undefined;
  /**
   * Posts one body. A send lost in transit (the visitor's network) resolves
   * `{ delivered: false }` — harmless, the next send carries on; any other
   * failure rejects and is left to surface (see `send` in instance.ts).
   */
  send: (body: CollectBody) => Promise<CollectSent>;
  /**
   * Hands an engagement beacon to the browser to deliver even if the page
   * goes away right after (`navigator.sendBeacon`): what a page hidden or
   * closed sends, where a `fetch` is more often dropped. No answer.
   */
  beacon: (body: EngagementBody) => void;
  /** A fresh random UUID (`crypto.randomUUID()`): each pageview's id. */
  mintId: () => string;
  /**
   * The performance timeline (`performance.now()`): pauses while the device
   * sleeps. Times the visible stretches, so engaged time never includes sleep,
   * and orders the load milestones.
   */
  now: () => number;
  /**
   * The wall clock (`Date.now()`): keeps running through sleep. Times the away
   * stretches (gaps) and the idle window, so a tab hidden or left through a
   * device sleep reports the real time away.
   */
  wallNow: () => number;
  /** Whether the page is visible right now (`document.visibilityState`). */
  isVisible: () => boolean;
  /**
   * Calls `fire` once, `delayMs` from now; the returned function cancels it.
   * The idle deadline — one timer, re-armed only when it fires early.
   */
  setDeadline: (delayMs: number, fire: () => void) => () => void;
  /** Whether a `<video>` / `<audio>` on the page is playing: watching is not idle. */
  isMediaPlaying: () => boolean;
  /**
   * The page load's milestones so far, as instants on the `now()` clock with
   * the navigation's start at 0 (null = not measured, or not yet). Read when
   * the load is sent: by the first hide or leave, the load is long done.
   */
  loadMilestones: () => LoadMilestones;
  /**
   * The sections registered on `path` so far, in page order (empty when it
   * has none). Read when a beacon is sent: by the first hide or leave, the
   * page has rendered.
   */
  pageSections: (path: string) => readonly string[];
  /** The page's viewport in CSS pixels right now, sent with each pageview. */
  viewport: () => Viewport;
}

/** When the page load reached each phase of {@link LoadTiming}, on the `now()` clock. */
export interface LoadMilestones {
  firstByteAt: number | null;
  /** Where the first byte went (boot-trace's split), null when not measured. */
  firstByte: FirstByteSplit | null;
  firstContentfulPaintAt: number | null;
  readyAt: number | null;
  /**
   * From when the page was no longer seen, by records that start with the
   * page (boot-trace's `readPageShown`: a hide before the tracker watched,
   * prerendering = 0); null while it was visible throughout.
   */
  notShownFrom: number | null;
}

/** One pageview whose visible time is being counted. */
interface CurrentPage {
  path: string;
  /** Minted here and sent with the pageview, so a beacon never waits for its answer. */
  pageviewId: string;
  /**
   * What the pageview's answer said: `pending` until it comes, `recorded`, or
   * `dropped` — lost on the way, or ignored (a bot): nothing to attach to.
   */
  recorded: "pending" | "recorded" | "dropped";
  /** Cumulative visible milliseconds, excluding the running stretch. */
  engagedMs: number;
  /** When the running visible stretch began, or null while hidden. */
  visibleSince: number | null;
  /** The engagedMs last sent, so a repeated hide never re-sends the same total. */
  sentMs: number;
  /**
   * An engagement went out before the pageview was known recorded — it lands
   * only if the pageview did first — so it is sent again once it is.
   */
  owed: boolean;
  /** `deps.wallNow()` when the pageview was recorded: what gap offsets count from. */
  startedAt: number;
  /** Closed away stretches, offsets from `startedAt`. */
  gaps: Gap[];
  /** The running away stretch (`at` is a `deps.wallNow()` instant), or null while present. */
  away: { kind: GapKind; at: number } | null;
  /** The gaps last sent (as JSON), so an unchanged list is not re-sent. */
  sentGaps: string;
  /** The page load's first pageview, whose first beacon still owes the load. */
  loadOwed: boolean;
  /** How many of the page's sections were last sent: the list only grows. */
  sentSections: number;
}

export interface Tracker {
  /** The route changed (or was first read). Records a pageview when the path did. */
  pathChanged: (rawPath: string) => void;
  /** The page became hidden or is being unloaded: report visible time so far. */
  hidden: () => void;
  /** The page became visible again: resume counting. */
  visible: () => void;
  /**
   * The visitor did something (pointer, key, wheel, scroll, touch, or media
   * started / stopped): ends an idle stretch and pushes the idle deadline back.
   */
  activity: () => void;
  /**
   * A custom event on the current page. `fallbackPath` is used before any
   * pageview was recorded (no tracker mounted).
   */
  track: (
    name: string,
    props: Record<string, string> | undefined,
    fallbackPath: string,
  ) => void;
  /** The path of the page being counted, or null before the first pageview. */
  currentPath: () => string | null;
}

/**
 * The tracker's state machine: one pageview per distinct path (its id minted
 * here), the landing source on the first pageview only, and visible time per
 * pageview reported as a cumulative total — by beacon on every hide and when
 * the visitor leaves the path, and on every event sent from the page — with
 * the pageview's away stretches: `hidden` from a hide to the next show, `idle`
 * from the last input to the next one once {@link IDLE_AFTER_MS} pass without
 * any while visible and no media plays. The page load's first pageview — the
 * hard load — carries how long the load took on its first beacon. A beacon
 * carries the page's full section list whenever it grew since the last one.
 *
 * One instance per page load (see instance.ts), so remounting the React
 * component — or mounting it in two tabs of the same document — can never count
 * a path twice.
 */
export function createTracker(deps: TrackerDeps): Tracker {
  let current: CurrentPage | null = null;
  let landingSent = false;
  /**
   * When the page was first hidden (0 if it was hidden before the tracker
   * watched): a paint after it is the tab being shown, not the load finishing.
   */
  let firstHiddenAt = deps.isVisible() ? Infinity : 0;
  /** The last input (or show, or path change): when an idle stretch would start. */
  let lastActivity = deps.wallNow();
  let cancelDeadline: (() => void) | null = null;

  const offset = (page: CurrentPage, at: number) => at - page.startedAt;

  /**
   * What says who the visitor is on a pageview or event: `owner: true` on a
   * marked browser, the consent key once they accepted; nothing otherwise.
   */
  const identity = (): { owner?: true; consentKey?: string } => {
    const consentKey = deps.consentKey();
    return {
      ...(deps.isOwner() ? { owner: true as const } : {}),
      ...(consentKey !== undefined ? { consentKey } : {}),
    };
  };

  /** Ends the running away stretch at `at`, keeping it if long enough. */
  const endAway = (page: CurrentPage, at: number) => {
    if (!page.away) return;
    page.gaps = appendGap(page.gaps, {
      kind: page.away.kind,
      startMs: offset(page, page.away.at),
      endMs: offset(page, at),
    });
    page.away = null;
  };

  /** The closed stretches plus the running one, cut at now: what a beacon carries. */
  const gapsSoFar = (page: CurrentPage): Gap[] =>
    page.away
      ? appendGap(page.gaps, {
          kind: page.away.kind,
          startMs: offset(page, page.away.at),
          endMs: offset(page, deps.wallNow()),
        })
      : page.gaps;

  const stopDeadline = () => {
    cancelDeadline?.();
    cancelDeadline = null;
  };

  /** Arms the idle deadline for `lastActivity + IDLE_AFTER_MS`, unless one is armed. */
  const armDeadline = () => {
    if (cancelDeadline) return;
    cancelDeadline = deps.setDeadline(
      Math.max(0, lastActivity + IDLE_AFTER_MS - deps.wallNow()),
      onDeadline,
    );
  };

  const onDeadline = () => {
    cancelDeadline = null;
    const page = current;
    if (!page || page.away || page.visibleSince === null) return;
    // Input since arming moved `lastActivity` without touching the timer (one
    // timer per idle window, not one per mousemove): wait out the rest.
    if (deps.wallNow() - lastActivity < IDLE_AFTER_MS) return armDeadline();
    // Playing media is watching, not idle. Its pause / end is an `activity()`,
    // which re-arms, so nothing has to look again until then.
    if (deps.isMediaPlaying()) return;
    page.away = { kind: "idle", at: Math.max(lastActivity, page.startedAt) };
  };

  const engaged = (page: CurrentPage) =>
    Math.min(
      MAX_ENGAGED_MS,
      Math.round(
        page.engagedMs +
          (page.visibleSince === null ? 0 : deps.now() - page.visibleSince),
      ),
    );

  /** The load as sent: paint milestones reached only after a hide do not count. */
  const loadTiming = (): LoadTiming => {
    const m = deps.loadMilestones();
    const hiddenFrom = Math.min(firstHiddenAt, m.notShownFrom ?? Infinity);
    const beforeHide = (at: number | null) =>
      at !== null && at < hiddenFrom ? at : null;
    return {
      ttfbMs: loadMs(m.firstByteAt),
      firstByte: firstByteOf(m.firstByte),
      fcpMs: loadMs(beforeHide(m.firstContentfulPaintAt)),
      readyMs: loadMs(beforeHide(m.readyAt)),
    };
  };

  const sendEngagement = (page: CurrentPage) => {
    if (page.recorded === "dropped") return;
    const engagedMs = engaged(page);
    const gaps = gapsSoFar(page);
    const gapsJson = JSON.stringify(gaps);
    const sections = deps.pageSections(page.path);
    if (
      engagedMs <= page.sentMs &&
      gapsJson === page.sentGaps &&
      !page.loadOwed &&
      sections.length <= page.sentSections
    )
      return;
    // The full list, whenever it grew (a page with none sends none).
    const grown =
      sections.length > page.sentSections ? { sections: [...sections] } : {};
    const load = page.loadOwed ? { load: loadTiming() } : {};
    const body: EngagementBody = {
      kind: "engagement",
      pageviewId: page.pageviewId,
      engagedMs,
      gaps,
      ...load,
      ...grown,
    };
    if (page.recorded === "pending") {
      // Sent now, in case the page goes away before the pageview's answer
      // (it lands if the pageview did first). Nothing is marked sent, so the
      // answer sends all of it again — the load and the sections included.
      page.owed = true;
      deps.beacon(body);
      return;
    }
    page.sentMs = engagedMs;
    page.sentGaps = gapsJson;
    page.sentSections = sections.length;
    page.loadOwed = false;
    deps.beacon(body);
  };

  const pause = (page: CurrentPage) => {
    if (page.visibleSince === null) return;
    page.engagedMs += deps.now() - page.visibleSince;
    page.visibleSince = null;
  };

  return {
    pathChanged(rawPath) {
      const path = pagePathOf(rawPath);
      if (current?.path === path) return;
      const now = deps.now();
      const wall = deps.wallNow();
      if (current) {
        endAway(current, wall);
        pause(current);
        sendEngagement(current);
      }
      const visible = deps.isVisible();
      // Hidden with no hide seen: it was hidden before anything watched.
      if (!visible && firstHiddenAt === Infinity) firstHiddenAt = 0;
      const page: CurrentPage = {
        path,
        pageviewId: deps.mintId(),
        recorded: "pending",
        engagedMs: 0,
        visibleSince: visible ? now : null,
        sentMs: 0,
        owed: false,
        startedAt: wall,
        gaps: [],
        away: visible ? null : { kind: "hidden", at: wall },
        sentGaps: "[]",
        // The first pageview is the hard load; later ones are in-app navigations.
        loadOwed: !landingSent,
        sentSections: 0,
      };
      current = page;
      // A new page is a fresh start for the idle clock.
      lastActivity = wall;
      if (visible) armDeadline();
      const source = landingSent ? {} : deps.landing;
      landingSent = true;
      void deps
        .send({
          kind: "pageview",
          host: deps.host,
          path,
          viewport: deps.viewport(),
          pageviewId: page.pageviewId,
          ...source,
          ...identity(),
        })
        .then((sent) => {
          // Lost on the way, or `ignored` (a bot): no pageview to attach to.
          if (!sent.delivered || sent.response.outcome !== "pageview") {
            page.recorded = "dropped";
            return;
          }
          page.recorded = "recorded";
          if (!page.owed) return;
          page.owed = false;
          sendEngagement(page);
        });
    },
    hidden() {
      firstHiddenAt = Math.min(firstHiddenAt, deps.now());
      if (!current) return;
      stopDeadline();
      // Repeated (visibilitychange, then pagehide): the hidden stretch runs on.
      if (current.away?.kind !== "hidden") {
        const wall = deps.wallNow();
        endAway(current, wall);
        current.away = { kind: "hidden", at: wall };
      }
      pause(current);
      sendEngagement(current);
    },
    visible() {
      if (!current || current.visibleSince !== null) return;
      const wall = deps.wallNow();
      endAway(current, wall);
      current.visibleSince = deps.now();
      lastActivity = wall;
      armDeadline();
    },
    activity() {
      lastActivity = deps.wallNow();
      if (!current || current.visibleSince === null) return;
      if (current.away?.kind === "idle") endAway(current, lastActivity);
      armDeadline();
    },
    track(name, props, fallbackPath) {
      // The page's visible time so far rides along: a visit whose beacons are
      // all lost still has what its events saw.
      const engagement =
        current && current.recorded !== "dropped"
          ? {
              engagement: {
                pageviewId: current.pageviewId,
                engagedMs: engaged(current),
              },
            }
          : {};
      void deps.send({
        kind: "event",
        host: deps.host,
        path: current?.path ?? pagePathOf(fallbackPath),
        name,
        ...(props !== undefined ? { props } : {}),
        ...identity(),
        ...engagement,
      });
    },
    currentPath: () => current?.path ?? null,
  };
}
