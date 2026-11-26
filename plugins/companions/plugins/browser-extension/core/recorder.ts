import { z } from "zod";

/**
 * The tab recorder's contracts, parsed by every half that speaks them:
 *
 * - the panel ↔ shell bridge methods (`core/bridge.ts`) carry
 *   {@link RecorderOptionsSchema} and answer {@link RecorderStateSchema};
 * - the popup ↔ service worker ↔ offscreen document messages
 *   ({@link WorkerCommandSchema}, {@link OffscreenCommandSchema},
 *   {@link OffscreenEventSchema});
 * - the offscreen document ↔ relay page port ({@link RelayRequestSchema}):
 *   the relay is an equin page, so its uploads are same-origin, as the owner.
 *
 * The worker owns the session; its state lives in `chrome.storage.session`
 * (it survives the worker being stopped mid-recording, and the popup reads it
 * by push through `storage.onChanged`).
 */

export const RecordPresetIdSchema = z.enum([
  "720p",
  "1080p",
  "1440p",
  "vertical",
  "as-is",
]);

/** What the panel's Record row sets. Kept by the extension (`storage.local`),
 *  so ⌥⇧R starts with the panel's last choice. */
export const RecorderOptionsSchema = z.object({
  preset: RecordPresetIdSchema,
  tabAudio: z.boolean(),
  mic: z.boolean(),
  /** A ripple drawn into the page on each click, so it is in the video. The
   *  pointer itself is Chrome's: tab capture composites the OS cursor while
   *  the mouse moves over the tab (hidden after 2 s still), and an extension
   *  cannot turn that off — so the recorder never draws one of its own. */
  clicks: z.boolean(),
  countdown: z.boolean(),
});
export type RecorderOptions = z.infer<typeof RecorderOptionsSchema>;

export const DEFAULT_RECORDER_OPTIONS: RecorderOptions = {
  // 720p: the one landscape layout a laptop's screen takes (a 1080p page is
  // bigger than a 14-inch MacBook's).
  preset: "720p",
  tabAudio: true,
  mic: false,
  clicks: true,
  countdown: true,
};

/** A recording saved to the Recordings folder. */
export const SavedRecordingSchema = z.object({
  /** Absolute path of the video. */
  path: z.string(),
  /** Its folder (absolute) and file name. */
  folder: z.string(),
  name: z.string(),
  bytes: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** A small JPEG of the last frame (`data:` URL), or `null`. */
  thumbnail: z.string().nullable(),
});
export type SavedRecording = z.infer<typeof SavedRecordingSchema>;

/**
 * Why a recording stopped. Anything but `user` stopped it on its own, and the
 * panel says so — a recording that ended early is never shown as a plain save.
 */
export const StopCauseSchema = z.enum([
  /** Stop in the panel, or ⌥⇧R. */
  "user",
  /** The window's size changed mid-recording (one size per video). */
  "window-resized",
  /** Chrome ended the tab's capture (the tab closed, …). */
  "capture-ended",
  /** equin refused or never answered an upload: the video holds what it
   *  took before (the failure itself is the saved state's `failure`). */
  "upload-failed",
]);
export type StopCause = z.infer<typeof StopCauseSchema>;

/** Why it stopped, in words: completes "It stopped because …". */
export function stopCauseText(cause: StopCause): string {
  switch (cause) {
    case "user":
      return "you stopped it";
    case "window-resized":
      return "the window was resized while recording (a video keeps one size)";
    case "capture-ended":
      return "Chrome ended the tab's capture (the tab closed, or went to a page Chrome does not capture)";
    case "upload-failed":
      return "equin stopped taking the video, so it holds what was uploaded before";
  }
}

/** The failure of a recording that stopped before any video was recorded:
 *  never finished as a file, and the reason it stopped is the message. */
export function emptyRecordingText(cause: StopCause): string {
  return `Nothing was recorded: it stopped before its first second, because ${stopCauseText(cause)}.`;
}

/** What the last recording came to, shown until the next one starts. */
export const LastRecordingSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("saved"),
    recording: SavedRecordingSchema,
    /** Why it stopped; `null` from a shell older than the field (the page
     *  can be newer than the shell), which did not say. */
    stoppedBy: StopCauseSchema.nullable().default(null),
    /** What went wrong, for a recording stopped by `upload-failed`; `null`
     *  otherwise (and from a shell older than the field). */
    failure: z.string().nullable().default(null),
  }),
  z.object({ kind: z.literal("failed"), error: z.string() }),
]);
export type LastRecording = z.infer<typeof LastRecordingSchema>;

/** A recording's clock: where recorded time (pauses excluded) stands, in
 *  epoch ms. The worker's state holds it, and the content script samples the
 *  pointer on it — so every page of a recording (a navigation injects a new
 *  script) stamps its samples on the one timeline the video has. */
export const RecordingClockSchema = z.object({
  /** When capture started (epoch ms). */
  startedAt: z.number(),
  /** Time spent paused before the current stretch, ms. */
  pausedMs: z.number().nonnegative(),
  /** When the current pause began (epoch ms), `null` while recording. */
  pausedAt: z.number().nullable(),
});
export type RecordingClock = z.infer<typeof RecordingClockSchema>;

/** Where the session stands. */
export const RecorderStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("idle"), last: LastRecordingSchema.nullable() }),
  /** Measuring, resizing, counting down, starting the capture. */
  z.object({ kind: z.literal("starting"), options: RecorderOptionsSchema }),
  z.object({
    kind: z.literal("recording"),
    options: RecorderOptionsSchema,
    ...RecordingClockSchema.shape,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  /** Flushing the last chunk and finishing the file. */
  z.object({ kind: z.literal("saving") }),
]);
export type RecorderState = z.infer<typeof RecorderStateSchema>;

/** Recorded time on `clock` at `now` (epoch ms), pauses excluded. */
export function recordedMs(clock: RecordingClock, now: number): number {
  return (clock.pausedAt ?? now) - clock.startedAt - clock.pausedMs;
}

/** The clock part of a `recording` state. */
export function clockOf(
  state: Extract<RecorderState, { kind: "recording" }>,
): RecordingClock {
  return {
    startedAt: state.startedAt,
    pausedMs: state.pausedMs,
    pausedAt: state.pausedAt,
  };
}

/** The microphone grant, for the extension's origin. */
export const MicPermissionSchema = z.enum(["granted", "prompt", "denied"]);
export type MicPermission = z.infer<typeof MicPermissionSchema>;

// ── Pointer ─────────────────────────────────────────────────────────────────

/** One pointer sample: recorded time (ms on the recording's clock, pauses
 *  excluded — the video's time), CSS px in the viewport, and what happened. */
export const PointerSampleSchema = z.tuple([
  z.number(),
  z.number(),
  z.number(),
  z.enum(["move", "down", "up", "leave"]),
]);
export type PointerSample = z.infer<typeof PointerSampleSchema>;

/** Every pointer sample of one recording, across the pages it went through:
 *  saved inside the video (the recorder's `cursorTrackBox`, read back with
 *  `readCursorTrack`). */
export const PointerTrackSchema = z.object({
  version: z.literal(1),
  /** The page's viewport the samples are in, CSS px. */
  viewport: z.object({ width: z.number(), height: z.number() }),
  samples: z.array(PointerSampleSchema),
});
export type PointerTrack = z.infer<typeof PointerTrackSchema>;

// ── Popup → worker ──────────────────────────────────────────────────────────

export const WorkerCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("recorder.start"),
    tabId: z.number().int(),
    options: RecorderOptionsSchema,
  }),
  /** Size the tab's window to a preset's page now, without recording (kept
   *  so: nothing puts it back). */
  z.object({
    type: z.literal("recorder.apply-size"),
    tabId: z.number().int(),
    preset: RecordPresetIdSchema,
  }),
  z.object({ type: z.literal("recorder.stop") }),
  z.object({ type: z.literal("recorder.pause") }),
  z.object({ type: z.literal("recorder.resume") }),
  z.object({ type: z.literal("recorder.discard") }),
  z.object({ type: z.literal("recorder.forget-last") }),
]);
export type WorkerCommand = z.infer<typeof WorkerCommandSchema>;

/** The worker's answer to a command: done, or why not. */
export const WorkerReplySchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type WorkerReply = z.infer<typeof WorkerReplySchema>;

// ── Worker ↔ offscreen document ─────────────────────────────────────────────

export const OffscreenCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("offscreen.start"),
    streamId: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    tabAudio: z.boolean(),
    mic: z.boolean(),
    /** The recorded tab's title, for the file name. */
    title: z.string(),
    /** The page's viewport, CSS px: what the pointer samples are in. */
    viewport: z.object({ width: z.number(), height: z.number() }),
  }),
  /** The content script's pointer samples since its last batch (from the
   *  page, not the worker): the offscreen document keeps the recording's
   *  track, so a navigation — which takes the page's script with it — loses
   *  none. Answers once kept. */
  z.object({
    type: z.literal("offscreen.pointer"),
    samples: z.array(PointerSampleSchema),
  }),
  z.object({ type: z.literal("offscreen.pause") }),
  z.object({ type: z.literal("offscreen.resume") }),
  z.object({
    type: z.literal("offscreen.stop"),
    /** Why it stops: the failure's words if nothing was recorded. */
    stoppedBy: StopCauseSchema,
    durationMs: z.number().nonnegative(),
  }),
  z.object({ type: z.literal("offscreen.discard") }),
]);
export type OffscreenCommand = z.infer<typeof OffscreenCommandSchema>;

/** The offscreen document's answers (to `start` and `stop`). */
export const OffscreenReplySchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    saved: SavedRecordingSchema.nullable(),
    /** A stop's: the upload failure the recording ended on (what was
     *  uploaded before it is `saved`), whatever stopped it; `null` when every
     *  upload went through. */
    failure: z.string().nullable().default(null),
  }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type OffscreenReply = z.infer<typeof OffscreenReplySchema>;

/** What the offscreen document reports on its own: the capture ended (the
 *  tab closed) or an upload failed. The worker then stops the session. */
export const OffscreenEventSchema = z.object({
  type: z.literal("offscreen.ended"),
  reason: z.enum(["track-ended", "error"]),
  error: z.string().nullable(),
});
export type OffscreenEvent = z.infer<typeof OffscreenEventSchema>;

// ── Worker ↔ content script (countdown, clicks, pointer track) ─────────────

export const ContentCommandSchema = z.discriminatedUnion("type", [
  /** 3-2-1 over the page; answers once it is gone from the screen. */
  z.object({ type: z.literal("content.countdown") }),
  /** Sample the pointer on the recording's `clock`, each batch sent to the
   *  offscreen document, and draw a ripple on each click when `clicks`. A
   *  page already tracking (the script injected again into the same page)
   *  keeps its session, on the clock given. */
  z.object({
    type: z.literal("content.track-start"),
    clicks: z.boolean(),
    clock: RecordingClockSchema,
  }),
  /** The recording paused or resumed: its new clock. */
  z.object({
    type: z.literal("content.track-clock"),
    clock: RecordingClockSchema,
  }),
  /** Remove everything. `handOver` (a stop): the last samples are sent
   *  first, and it answers once the offscreen document holds every one;
   *  without (a discard, a failed start), they are dropped with the
   *  recording. */
  z.object({ type: z.literal("content.finish"), handOver: z.boolean() }),
]);
export type ContentCommand = z.infer<typeof ContentCommandSchema>;

// ── Offscreen document ↔ relay page ─────────────────────────────────────────

export const RelayRequestSchema = z.discriminatedUnion("op", [
  z.object({
    id: z.number().int(),
    op: z.literal("create"),
    title: z.string(),
  }),
  z.object({
    id: z.number().int(),
    op: z.literal("chunk"),
    recordingId: z.string(),
    seq: z.number().int().nonnegative(),
    bytes: z.instanceof(ArrayBuffer),
  }),
  z.object({
    id: z.number().int(),
    op: z.literal("finish"),
    recordingId: z.string(),
    durationMs: z.number().nonnegative(),
    pointer: PointerTrackSchema.nullable(),
  }),
  z.object({
    id: z.number().int(),
    op: z.literal("discard"),
    recordingId: z.string(),
  }),
]);
export type RelayRequest = z.infer<typeof RelayRequestSchema>;

/** The relay's answer: the endpoint's response body, or its error. */
export const RelayResponseSchema = z.discriminatedUnion("ok", [
  z.object({ id: z.number().int(), ok: z.literal(true), value: z.unknown() }),
  z.object({
    id: z.number().int(),
    ok: z.literal(false),
    error: z.string(),
    /** equin did not answer (a backend switch on redeploy, the gateway's
     *  own error page): the same request is sent again. `false`: it
     *  answered and refused — the request is never sent again. */
    retry: z.boolean().default(false),
  }),
]);
export type RelayResponse = z.infer<typeof RelayResponseSchema>;

/** `create`'s answer. */
export const RelayCreatedSchema = z.object({
  recordingId: z.string(),
  folder: z.string(),
});

/** `finish`'s answer. */
export const RelayFinishedSchema = z.object({
  path: z.string(),
  folder: z.string(),
  name: z.string(),
  bytes: z.number().int().nonnegative(),
});
export type RelayFinished = z.infer<typeof RelayFinishedSchema>;

/** The relay page, framed by the offscreen document. */
export const RECORDER_RELAY_PATH = "/home/browser-extension-recorder";

// ── Panel ↔ shell ───────────────────────────────────────────────────────────

const RectSchema = z.object({
  left: z.number(),
  top: z.number(),
  width: z.number(),
  height: z.number(),
});

/** `viewport.ts`'s `TabMeasure`, on the wire. */
export const TabMeasureSchema = z.object({
  window: RectSchema,
  windowState: z.string(),
  innerWidth: z.number(),
  innerHeight: z.number(),
  devicePixelRatio: z.number(),
  zoom: z.number(),
  workArea: RectSchema,
});

/** The tab the popup is about, measured — or why it cannot be (a
 *  `chrome://` page, the Web Store: Chrome lets no extension script them). */
export const TabFitSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("measured"), measure: TabMeasureSchema }),
  z.object({ kind: z.literal("unrecordable"), reason: z.string() }),
]);
export type TabFit = z.infer<typeof TabFitSchema>;

/** `recorder()`'s answer, and every push after it. */
export const RecorderSnapshotSchema = z.object({
  state: RecorderStateSchema,
  options: RecorderOptionsSchema,
  mic: MicPermissionSchema,
});
export type RecorderSnapshot = z.infer<typeof RecorderSnapshotSchema>;

/** The command the panel sends a running (or finished) session. */
export const RecorderCommandSchema = z.enum([
  "stop",
  "pause",
  "resume",
  "discard",
  "forget-last",
]);
export type RecorderCommand = z.infer<typeof RecorderCommandSchema>;
