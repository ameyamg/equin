/**
 * The extension's service worker: the tab recorder's session owner. The popup
 * forwards the panel's Record / Stop / Pause / Discard here (and ⌥⇧R arrives
 * here as a command), because the popup closes as soon as the user clicks back
 * into the page — nothing about a session may live in it.
 *
 * A recording: measure the tab, resize its window so the page is the preset's
 * layout (old bounds kept to put back), count down in the page (before the
 * capture, so it is never in the video), take a tab-capture stream id and hand
 * it to the offscreen document, which records and uploads through the relay
 * page. Stop flushes, saves, restores the window and clears the badge.
 *
 * The worker can be stopped by Chrome at any time: the state is in
 * `chrome.storage.session` (`recorder-store.ts`), the session's facts too
 * ({@link SESSION_KEY}), so a restarted worker picks up where it was.
 *
 * Bundled by the build (`cli/internal/write-shell.ts`). Contracts:
 * `core/recorder.ts`, sizes: `core/viewport.ts`.
 */
import { z } from "zod";
import {
  ContentCommandSchema,
  OffscreenEventSchema,
  OffscreenReplySchema,
  PointerTrackSchema,
  recordedMs,
  WorkerCommandSchema,
  type ContentCommand,
  type OffscreenCommand,
  type PointerTrack,
  type RecorderOptions,
  type RecorderState,
  type SavedRecording,
  type StopCause,
  type WorkerCommand,
  type WorkerReply,
} from "../core/recorder";
import {
  outputFor,
  recordPreset,
  sizeRefusalText,
  windowBoundsFor,
  type RecordPresetId,
  type TabMeasure,
  type WindowBounds,
} from "../core/viewport";
import {
  chrome,
  errorText,
  permitted,
  messageType,
  onMessageAsync,
  sendToExtension,
  sendToTab,
  type ChromeWindow,
} from "./chrome-api";
import {
  readRecorderOptions,
  readRecorderState,
  writeRecorderState,
} from "./recorder-store";
import { measureTab } from "./measure";
import { wallNow } from "@plugins/packages/plugins/deadline/core";

/** The running session's facts, beside its state. */
const SESSION_KEY = "recorder.session";
const SessionSchema = z.object({
  tabId: z.number().int(),
  windowId: z.number().int(),
  /** The window as it was, put back on stop; `null`: not resized. */
  restore: z
    .object({
      left: z.number(),
      top: z.number(),
      width: z.number(),
      height: z.number(),
      state: z.string(),
    })
    .nullable(),
  /** The window's size once recording started (`null` before): only a
   *  change from it stops the recording, not a late event of our own resize. */
  recordedSize: z.object({ width: z.number(), height: z.number() }).nullable(),
});
type Session = z.infer<typeof SessionSchema>;

const REC_RED = "#e5383b";

// The recording's clock is the person's: a timer they watch, a duration they
// share — wall time (`wallNow("human-time")`).

// ── State ───────────────────────────────────────────────────────────────────

async function setState(state: RecorderState): Promise<void> {
  await writeRecorderState(state);
  await paintBadge(state);
}

async function paintBadge(state: RecorderState): Promise<void> {
  const text =
    state.kind === "recording"
      ? state.pausedAt === null
        ? "REC"
        : "II"
      : state.kind === "saving"
        ? "…"
        : state.kind === "idle" && state.last?.kind === "failed"
          ? "ERR"
          : "";
  await chrome.action.setBadgeBackgroundColor({ color: REC_RED });
  await chrome.action.setBadgeTextColor?.({ color: "#ffffff" });
  await chrome.action.setBadgeText({ text });
  await chrome.action.setTitle({
    title:
      state.kind === "recording" ? "equin — recording · ⌥⇧R to stop" : "equin",
  });
}

async function readSession(): Promise<Session | null> {
  const raw = (await permitted("storage").session.get(SESSION_KEY))[
    SESSION_KEY
  ];
  return raw === undefined ? null : SessionSchema.parse(raw);
}

async function writeSession(session: Session | null): Promise<void> {
  if (session === null) await permitted("storage").session.remove(SESSION_KEY);
  else await permitted("storage").session.set({ [SESSION_KEY]: session });
}

// ── Messages to the other contexts ──────────────────────────────────────────

async function toContent(
  tabId: number,
  command: ContentCommand,
): Promise<unknown> {
  const answer = await sendToTab(tabId, ContentCommandSchema.parse(command));
  // The content script answers a failure as `{ error }`.
  if (typeof answer === "object" && answer !== null && "error" in answer)
    throw new Error(String((answer as { error: unknown }).error));
  return answer;
}

async function toOffscreen(
  command: OffscreenCommand,
): Promise<SavedRecording | null> {
  return (await offscreenReply(command)).saved;
}

/** The offscreen document's answer: what it saved, and any upload failure. */
async function offscreenReply(
  command: OffscreenCommand,
): Promise<{ saved: SavedRecording | null; failure: string | null }> {
  const reply = OffscreenReplySchema.parse(await sendToExtension(command));
  if (!reply.ok) throw new Error(reply.error);
  return reply;
}

async function hasOffscreen(): Promise<boolean> {
  if (chrome.runtime.getContexts === undefined)
    throw new Error(
      "This Chrome is too old to record (it lacks runtime.getContexts).",
    );
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  return contexts.length > 0;
}

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return;
  await permitted("offscreen").createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Records the tab you asked to record.",
  });
}

async function closeOffscreen(): Promise<void> {
  if (await hasOffscreen()) await permitted("offscreen").closeDocument();
}

// ── The window ──────────────────────────────────────────────────────────────

/**
 * Size the window so the tab's page is `page` (un-maximized first): resize,
 * wait for the page to
 * take it, and correct once by what is left (the chrome can change as the
 * window shrinks — a bookmarks bar wrapping). Still off: fail loudly.
 */
async function sizeWindow(
  tabId: number,
  win: { id: number; state?: ChromeWindow["state"] },
  page: { width: number; height: number },
): Promise<void> {
  const windowId = win.id;
  // A maximized (or full-screen) window takes no bounds: make it normal first.
  if (win.state !== "normal")
    await chrome.windows.update(windowId, { state: "normal" });
  let measure = await measureTab(tabId);
  for (let attempt = 0; attempt < 2; attempt++) {
    const bounds = windowBoundsFor(page, measure);
    if (!bounds.ok) throw new Error(sizeRefusalText(bounds.reason));
    await resizeTo(windowId, bounds.value);
    measure = await measureTab(tabId, page);
    if (
      measure.innerWidth === page.width &&
      measure.innerHeight === page.height
    )
      return;
  }
  throw new Error(
    `The window would not size the page to ${page.width} × ${page.height} (it is ${measure.innerWidth} × ${measure.innerHeight}).`,
  );
}

async function resizeTo(windowId: number, b: WindowBounds): Promise<void> {
  await chrome.windows.update(windowId, {
    left: Math.round(b.left),
    top: Math.round(b.top),
    width: Math.round(b.width),
    height: Math.round(b.height),
  });
}

async function restoreWindow(session: Session): Promise<void> {
  const r = session.restore;
  if (r === null) return;
  await chrome.windows.update(session.windowId, {
    left: r.left,
    top: r.top,
    width: r.width,
    height: r.height,
  });
  if (r.state === "maximized" || r.state === "fullscreen")
    await chrome.windows.update(session.windowId, {
      state: r.state as ChromeWindow["state"],
    });
}

// ── The session ─────────────────────────────────────────────────────────────

/**
 * Every command and event runs one at a time, in arrival order: ⌥⇧R pressed
 * twice, or the tab closing while Stop is clicked, must not run two stops
 * against one recording.
 */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work);
  // The queue goes on whatever one step did; the step's caller hears it.
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** End a session that failed: undo what it left, then idle with the error. */
async function fail(err: unknown): Promise<void> {
  const left = await abandon();
  await setState({
    kind: "idle",
    last: {
      kind: "failed",
      error: [errorText(err), ...left].join(" — and while cleaning up: "),
    },
  });
}

async function start(tabId: number, options: RecorderOptions): Promise<void> {
  const now = await readRecorderState();
  if (now.kind !== "idle") throw new Error("A recording is already running.");
  await setState({ kind: "starting", options });
  // The answer goes back at once (the popup closes as the window resizes);
  // the start itself is the next step of the queue, and a failure is the
  // state's to show (the panel's next open, the badge).
  void serial(() => begin(tabId, options).catch(fail));
}

async function begin(tabId: number, options: RecorderOptions): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  const win = await chrome.windows.get(tab.windowId);
  const preset = recordPreset(options.preset);
  const before = await measureTab(tabId);
  const session: Session = {
    tabId,
    windowId: tab.windowId,
    restore:
      preset.page === null
        ? null
        : {
            left: win.left ?? 0,
            top: win.top ?? 0,
            width: win.width ?? before.window.width,
            height: win.height ?? before.window.height,
            state: win.state ?? "normal",
          },
    recordedSize: null,
  };
  await writeSession(session);

  let measure: TabMeasure = before;
  if (preset.page !== null) {
    await sizeWindow(
      tabId,
      { id: tab.windowId, state: win.state },
      preset.page,
    );
    measure = await measureTab(tabId);
  }
  const output = outputFor(preset, measure);
  if (!output.ok) throw new Error(sizeRefusalText(output.reason));

  // Always: the pointer track is kept whatever the options draw.
  await permitted("scripting").executeScript({
    target: { tabId },
    files: ["content.js"],
  });
  if (options.countdown) await toContent(tabId, { type: "content.countdown" });

  const streamId = await permitted("tabCapture").getMediaStreamId({
    targetTabId: tabId,
  });
  await ensureOffscreen();
  await toOffscreen({
    type: "offscreen.start",
    streamId,
    width: output.value.width,
    height: output.value.height,
    tabAudio: options.tabAudio,
    mic: options.mic,
    title: tab.title ?? "",
  });
  await toContent(tabId, {
    type: "content.track-start",
    clicks: options.clicks,
  });
  const sized = await chrome.windows.get(tab.windowId);
  await writeSession({
    ...session,
    recordedSize: { width: sized.width ?? 0, height: sized.height ?? 0 },
  });
  await setState({
    kind: "recording",
    options,
    startedAt: wallNow("human-time"),
    pausedMs: 0,
    pausedAt: null,
    width: output.value.width,
    height: output.value.height,
  });
}

/**
 * Undo whatever a failed start or a discard left — the page's overlay, the
 * capture, the window's size — each step tried whatever the one before did.
 * Answers what could not be undone (the window was closed, …), for the
 * failure the panel shows.
 */
async function abandon(): Promise<string[]> {
  const left: string[] = [];
  const step = async (work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (err) {
      left.push(errorText(err));
    }
  };
  const session = await readSession();
  await writeSession(null);
  if (session !== null)
    await step(() =>
      toContent(session.tabId, { type: "content.finish" }).catch(
        (err: unknown) => {
          // The tab is gone (closed, navigated): nothing left to remove.
          if (!isGoneTab(err)) throw err;
        },
      ),
    );
  await step(closeOffscreen);
  if (session !== null) await step(() => restoreWindow(session));
  return left;
}

/** Chrome's answer when the page holds no content script any more. */
function isGoneTab(err: unknown): boolean {
  const text = errorText(err);
  return (
    text.includes("Receiving end does not exist") ||
    text.includes("No tab with id") ||
    text.includes("message port closed")
  );
}

/** Stop and save — as far as equin took it, when an upload failed. */
async function stop(stoppedBy: StopCause): Promise<void> {
  const state = await readRecorderState();
  if (state.kind !== "recording") throw new Error("Nothing is recording.");
  const session = await readSession();
  if (session === null) throw new Error("The recording session is lost.");
  await setState({ kind: "saving" });
  try {
    const pointer = await finishContent(session.tabId);
    const { saved, failure } = await offscreenReply({
      type: "offscreen.stop",
      stoppedBy,
      durationMs: recordedMs(state, wallNow("human-time")),
      pointer,
    });
    if (saved === null) throw new Error("The recording was not saved.");
    await writeSession(null);
    await closeOffscreen();
    await restoreWindow(session);
    await setState({
      kind: "idle",
      // An upload failure is why it ended, whatever asked it to stop (a
      // failure can land while a Stop flushes).
      last: {
        kind: "saved",
        recording: saved,
        stoppedBy: failure === null ? stoppedBy : "upload-failed",
        failure,
      },
    });
  } catch (err) {
    await fail(err);
  }
}

/** The pointer track the content script kept, or `null` once the tab is gone. */
async function finishContent(tabId: number): Promise<PointerTrack | null> {
  try {
    const answer = await toContent(tabId, { type: "content.finish" });
    return answer === null ? null : PointerTrackSchema.parse(answer);
  } catch (err) {
    if (isGoneTab(err)) return null;
    throw err;
  }
}

async function discard(): Promise<void> {
  const state = await readRecorderState();
  if (state.kind !== "recording") throw new Error("Nothing is recording.");
  await setState({ kind: "saving" });
  try {
    await toOffscreen({ type: "offscreen.discard" });
  } catch (err) {
    await fail(err);
    return;
  }
  const left = await abandon();
  await setState({
    kind: "idle",
    last:
      left.length === 0
        ? null
        : { kind: "failed", error: `Discarded, but: ${left.join("; ")}` },
  });
}

async function pause(paused: boolean): Promise<void> {
  const state = await readRecorderState();
  if (state.kind !== "recording") throw new Error("Nothing is recording.");
  if ((state.pausedAt !== null) === paused) return;
  const session = await readSession();
  await toOffscreen({ type: paused ? "offscreen.pause" : "offscreen.resume" });
  const now = wallNow("human-time");
  // The video is paused (or not) from here: the state says so before the
  // page is told, whatever the page does.
  await setState(
    paused
      ? { ...state, pausedAt: now }
      : {
          ...state,
          pausedAt: null,
          pausedMs: state.pausedMs + (now - (state.pausedAt ?? now)),
        },
  );
  if (session !== null)
    await toContent(session.tabId, {
      type: paused ? "content.track-pause" : "content.track-resume",
    }).catch((err: unknown) => {
      // The page navigated: its new content script starts as the state says.
      if (!isGoneTab(err)) throw err;
    });
}

/**
 * Size the tab's window to `presetId`'s page now, without recording — the
 * size dropdown's Apply. The window keeps it (no restore: there is no
 * session to end). Refused mid-recording: the recording keeps one size.
 */
async function applySize(
  tabId: number,
  presetId: RecordPresetId,
): Promise<void> {
  const state = await readRecorderState();
  if (state.kind !== "idle")
    throw new Error("A recording is running: its window keeps its size.");
  const preset = recordPreset(presetId);
  if (preset.page === null)
    throw new Error(`${preset.label} keeps the window as it is.`);
  const tab = await chrome.tabs.get(tabId);
  const win = await chrome.windows.get(tab.windowId);
  await sizeWindow(tabId, { id: tab.windowId, state: win.state }, preset.page);
}

async function command(cmd: WorkerCommand): Promise<void> {
  switch (cmd.type) {
    case "recorder.start":
      return start(cmd.tabId, cmd.options);
    case "recorder.apply-size":
      return applySize(cmd.tabId, cmd.preset);
    case "recorder.stop":
      return stop("user");
    case "recorder.pause":
      return pause(true);
    case "recorder.resume":
      return pause(false);
    case "recorder.discard":
      return discard();
    case "recorder.forget-last": {
      const state = await readRecorderState();
      if (state.kind === "idle") await setState({ kind: "idle", last: null });
      return;
    }
  }
}

// ── Listeners (registered at the top level, as MV3 requires) ────────────────

onMessageAsync(
  (m) => messageType(m)?.startsWith("recorder.") === true,
  async (message): Promise<WorkerReply> => {
    const cmd = WorkerCommandSchema.parse(message);
    await serial(() => command(cmd));
    return { ok: true };
  },
);

// The offscreen document keeps this worker awake through a long finish.
onMessageAsync(
  (m) => messageType(m) === "offscreen.heartbeat",
  async () => null,
);

// The offscreen document says the capture ended (the tab closed) or failed.
onMessageAsync(
  (m) => messageType(m) === "offscreen.ended",
  async (message) => {
    const event = OffscreenEventSchema.parse(message);
    await serial(async () => {
      const state = await readRecorderState();
      if (state.kind !== "recording") return;
      // An upload failed: stopped and saved as far as equin took it (the
      // offscreen finishes what was uploaded), the failure said beside it.
      if (event.reason === "error") await stop("upload-failed");
      else await stop("capture-ended");
    });
    return null;
  },
);

permitted("commands").onCommand.addListener((name, tab) => {
  if (name !== "toggle-recording") return;
  void serial(() => toggle(tab?.id).catch(fail));
});

async function toggle(tabId: number | undefined): Promise<void> {
  const state = await readRecorderState();
  if (state.kind === "recording") return stop("user");
  if (state.kind !== "idle") return;
  if (tabId === undefined) throw new Error("There is no tab to record.");
  await start(tabId, await readRecorderOptions());
}

// A manual resize mid-recording would change the video's size: stop instead
// (a recording of one size, never a variable one).
//
// The event only says the bounds changed; what decides is the window's size
// NOW, read when the step runs. The event's own window is a snapshot from
// when it fired — and the start's own resize (un-maximize, size, correct)
// fires events that queue behind the start and run once it is recording:
// judged by their snapshot, they stopped every recording from a maximized
// window as the countdown ended (2026-11-25, `e2e/session-probe.ts`).
chrome.windows.onBoundsChanged.addListener((changed) => {
  void serial(async () => {
    const state = await readRecorderState();
    if (state.kind !== "recording") return;
    const session = await readSession();
    if (session === null || session.windowId !== changed.id) return;
    const at = session.recordedSize;
    if (at === null) return;
    const win = await chrome.windows.get(session.windowId);
    if (win.width === at.width && win.height === at.height) return;
    await stop("window-resized");
  });
});

// The recorded tab navigated: its content script went with the old page, so
// track (and draw clicks) again on the new one — its samples start over
// there. Chrome also says `complete` after an in-page navigation, which keeps
// the script: the new injection takes its session over (content.ts), and
// `track-start` leaves a running one alone.
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status !== "complete") return;
  void serial(async () => {
    const state = await readRecorderState();
    if (state.kind !== "recording") return;
    const session = await readSession();
    if (session === null || session.tabId !== tabId) return;
    await permitted("scripting").executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    await toContent(tabId, {
      type: "content.track-start",
      clicks: state.options.clicks,
    });
    if (state.pausedAt !== null)
      await toContent(tabId, { type: "content.track-pause" });
  });
});

// A worker Chrome restarted finds the state it left. A session whose
// offscreen recorder is gone (Chrome was quit, the extension reloaded) can
// never finish: say so rather than stay "recording" for good.
void serial(async () => {
  const state = await readRecorderState();
  if (state.kind === "idle" || (await hasOffscreen())) return;
  await fail(
    new Error("The recording was interrupted: Chrome stopped the recorder."),
  );
});
