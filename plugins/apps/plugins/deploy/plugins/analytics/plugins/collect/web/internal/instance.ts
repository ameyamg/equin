import { isLostInTransit } from "@plugins/infra/plugins/endpoints/core";
import {
  beaconEndpointOver,
  fetchEndpointOver,
} from "@plugins/infra/plugins/endpoints/web";
import { pageTransport } from "@plugins/primitives/plugins/networking/plugins/page-transport/web";
import { currentRoutePath } from "@plugins/primitives/plugins/pane/web";
import {
  notShownFromMs,
  ROUTE_CONTENT_COMMIT_ID,
} from "@plugins/primitives/plugins/perfs/plugins/boot-trace/core";
import {
  getBootTrace,
  readFirstByteSplit,
  readPageShown,
} from "@plugins/primitives/plugins/perfs/plugins/boot-trace/web";
import {
  EVENT_NAME_PATTERN,
  collectEndpoint,
  pagePathOf,
  type CollectBody,
  type EngagementBody,
} from "../../core";
import { consentKeyOf, consentStore } from "./consent";
import { landingSource } from "./landing";
import {
  applyOwnerFragment,
  isOwnerMarked,
  ownerMarkStore,
} from "./owner-mark";
import { navigate } from "@plugins/apps-core/plugins/tabs/web";
import { createPageSectionRegistry } from "./page-sections";
import { followReplay } from "./replay-follow";
import { watchOutboundLinks, type OutboundScope } from "./outbound";
import {
  createTracker,
  type CollectSent,
  type LoadMilestones,
  type Tracker,
} from "./tracker";

// Page-wide telemetry: page-view analytics always reach the page's own server (D3).
const fetchEndpoint = fetchEndpointOver(pageTransport);
const beaconEndpoint = beaconEndpointOver(pageTransport);

/**
 * Posts one collect body. `keepalive` lets the engagement beacon sent on
 * `pagehide` outlive the page.
 *
 * Passive telemetry: `report: false`, so a failed beacon never toasts or
 * files a report about itself. A beacon lost between the page and the site
 * (`isLostInTransit`: no answer, an answer cut short, a proxy answering in
 * the site's place) is the visitor's network — offline, a suspended mobile
 * tab, a reply cut off while the tab was hidden, a corporate proxy — and
 * harmless: the hit is not counted, the next send carries on. It resolves
 * `{ delivered: false }` with a console warning. Every other failure — the
 * site's own refusal or 5xx, an unreadable answer, a bug here — rejects,
 * is left unhandled, and the crash collector files it.
 */
async function send(body: CollectBody): Promise<CollectSent> {
  try {
    const response = await fetchEndpoint(
      collectEndpoint,
      {},
      { body, keepalive: true, report: false },
    );
    return { delivered: true, response };
  } catch (err) {
    if (!isLostInTransit(err)) throw err;
    console.warn(`[analytics] ${body.kind} not counted — ${err.message}`);
    return { delivered: false };
  }
}

/**
 * Hands one engagement beacon to the browser (`sendBeacon`), which delivers it
 * even if the page is going away — the hide / close send a `keepalive` fetch
 * was dropped on (mostly mobile Safari: 2026-11, a fifth of one-page visits had no
 * engagement at all while their events landed). No answer comes back. A
 * refusal (the browser's in-flight beacon quota is full) is the visitor's
 * browser, like a send lost in transit: not counted, with a console warning.
 */
function beacon(body: EngagementBody): void {
  const sent = beaconEndpoint(collectEndpoint, {}, { body });
  if (sent.kind === "refused")
    console.warn(
      "[analytics] engagement not counted — the browser refused the beacon",
    );
}

let instance: Tracker | null = null;

/**
 * Records every outbound link click under `scope` (`outbound.ts`) until the
 * returned uninstall — called by `<AnalyticsTracker />` in an effect, so the
 * listener lives exactly as long as the tracker that knows the app.
 */
export function watchOutboundLinksUnder(scope: OutboundScope): () => void {
  const tracker = getTracker();
  return watchOutboundLinks(document, {
    scope,
    pageUrl: () => window.location.href,
    path: () => tracker.currentPath() ?? pagePathOf(currentRoutePath()),
    sectionOf: (path, el) => pageSections.sectionOf(path, el),
    track: (name, props) => track(name, props),
  });
}

/** The page load's sections per path; module scope, like the tracker. */
const pageSections = createPageSectionRegistry();

/**
 * Lists `el` as section `section` of the page the address shows now, for the
 * page's full section list its beacons carry. Returns the unmount.
 */
export function registerPageSection(el: Element, section: string): () => void {
  return pageSections.register(pagePathOf(currentRoutePath()), el, section);
}

/** Input that says someone is at the page (passive listeners, capture phase so element scrolls count). */
const INPUT_EVENTS = [
  "pointermove",
  "pointerdown",
  "keydown",
  "wheel",
  "scroll",
  "touchstart",
] as const;
/**
 * Media starting or stopping. They do not bubble, hence capture. A pause or
 * end restarts the idle clock the playback was holding off.
 */
const MEDIA_EVENTS = ["play", "pause", "ended"] as const;

/**
 * Audible media playing. A muted (decorative, autoplaying) loop never pauses,
 * so counting it would keep a tab left open on it from ever reading as idle.
 */
function isMediaPlaying(): boolean {
  for (const media of document.querySelectorAll("video, audio"))
    if (
      media instanceof HTMLMediaElement &&
      !media.paused &&
      !media.ended &&
      !media.muted &&
      media.volume > 0
    )
      return true;
  return false;
}

/**
 * The page load's milestones, from the framework's boot trace (one clock:
 * `performance.now()`, navigation start = 0). Ready is the later of the first
 * contentful paint and the commit showing the active app's content — not
 * `bootWindowEnd`'s first commit, which on a site is its loading screen.
 * Paint timing may be unsupported: its milestones then stay null.
 */
function loadMilestones(): LoadMilestones {
  const trace = getBootTrace();
  const fcp = trace.paint.firstContentfulPaintMs;
  const content =
    trace.spans.find((s) => s.id === ROUTE_CONTENT_COMMIT_ID)?.startMs ?? null;
  return {
    firstByteAt: trace.navigation?.responseStartMs ?? null,
    firstByte: readFirstByteSplit(),
    firstContentfulPaintAt: fcp,
    readyAt: content === null ? null : Math.max(content, fcp ?? 0),
    notShownFrom: notShownFromMs(readPageShown()),
  };
}

/** Applies a mark link's fragment to this browser (`owner-mark.ts`). */
function readOwnerFragment(): void {
  applyOwnerFragment(window.location.hash, ownerMarkStore);
}

/**
 * The page load's one tracker, created on first use. Module scope is the dedup
 * boundary: a remounted `<AnalyticsTracker />` (or two of them) reads the same
 * state, so a path is never counted twice. The landing source is read here, at
 * creation, which is the first moment anything is tracked.
 */
export function getTracker(): Tracker {
  if (instance) return instance;
  // A mark link (`#equin-me`) is read before the first pageview, so that
  // pageview is already the owner's.
  readOwnerFragment();
  window.addEventListener("hashchange", readOwnerFragment);
  const host = window.location.host;
  const tracker = createTracker({
    host,
    landing: landingSource({
      referrer: document.referrer,
      search: window.location.search,
      siteHost: host,
    }),
    isOwner: () => isOwnerMarked(ownerMarkStore),
    consentKey: () => consentKeyOf(consentStore),
    send,
    beacon,
    mintId: () => crypto.randomUUID(),
    now: () => performance.now(),
    wallNow: () => Date.now(),
    isVisible: () => document.visibilityState === "visible",
    setDeadline: (delayMs, fire) => {
      const timer = setTimeout(fire, delayMs);
      return () => clearTimeout(timer);
    },
    isMediaPlaying,
    loadMilestones,
    pageSections: (path) => pageSections.sectionsOf(path),
    viewport: () => ({
      w: Math.max(1, Math.round(window.innerWidth)),
      h: Math.max(1, Math.round(window.innerHeight)),
    }),
  });
  const activity = () => tracker.activity();
  for (const type of [...INPUT_EVENTS, ...MEDIA_EVENTS])
    document.addEventListener(type, activity, { capture: true, passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") tracker.hidden();
    else tracker.visible();
  });
  window.addEventListener("pagehide", () => tracker.hidden());
  window.addEventListener("pageshow", () => {
    // A bfcache restore can land in a background tab: its visibilitychange shows it later.
    if (document.visibilityState === "visible") tracker.visible();
  });
  instance = tracker;
  // A local page framed by the Sessions tab's replay follows its commands;
  // anywhere else this installs nothing.
  followReplay({
    host: window.location.host,
    parent: window.parent === window ? null : window.parent,
    navigate: (path) => navigate(path),
    currentPath: currentRoutePath,
    sectionElement: (path, name) => pageSections.elementOf(path, name),
    sectionsOf: (path) => pageSections.sectionsOf(path),
    addMessageListener: (fn) => window.addEventListener("message", fn),
  });
  return tracker;
}

/**
 * Records a custom event on the current page. `name` must match
 * `EVENT_NAME_PATTERN` (lowercase letters, digits, underscores); props are at
 * most `MAX_EVENT_PROPS` short strings.
 */
export function track(name: string, props?: Record<string, string>): void {
  // A bad name is a programming error the server would only answer with a 400
  // no one reads: refuse it at the call site instead.
  if (!EVENT_NAME_PATTERN.test(name))
    throw new Error(
      `[analytics] event name ${JSON.stringify(name)} must match ${String(EVENT_NAME_PATTERN)}`,
    );
  getTracker().track(name, props, currentRoutePath());
}
