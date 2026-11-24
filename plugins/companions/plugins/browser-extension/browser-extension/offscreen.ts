/**
 * The recorder's offscreen document (reason USER_MEDIA): turns the worker's
 * tab-capture stream id into a `MediaStream`, scaled by Chrome to the preset's
 * video size, mixes the tab's audio and the microphone into one track, and
 * records it as H.264/AAC MP4 in 1 s chunks.
 *
 * It never calls equin itself — a fetch from the extension's origin reaches
 * the gateway as anonymous. It frames the hidden relay page
 * (`RECORDER_RELAY_PATH`, an equin page) and hands it each chunk over a
 * `MessagePort` (the bridge's own hello → port handshake), strictly in order;
 * the relay posts them same-origin, as the owner.
 *
 * Bundled by the build (`cli/internal/write-shell.ts`), which writes the equin
 * origin into `offscreen.html`.
 */
import { BRIDGE_PORT, BridgeHelloSchema } from "../core/bridge";
import {
  OffscreenCommandSchema,
  RECORDER_RELAY_PATH,
  RelayCreatedSchema,
  RelayFinishedSchema,
  RelayResponseSchema,
  type OffscreenCommand,
  type OffscreenEvent,
  type OffscreenReply,
  type PointerTrack,
  type RelayRequest,
  type SavedRecording,
} from "../core/recorder";
import { chrome, errorText, messageType, onMessageAsync } from "./chrome-api";

const FRAME_RATE = 30;
/** Chunks waiting to upload past this stop the recording: never an unbounded
 *  buffer, never a silent drop. */
const MAX_QUEUED_BYTES = 64 * 1024 * 1024;
const THUMB_WIDTH = 160;

function meta(name: string): string {
  const value = document
    .querySelector(`meta[name="${name}"]`)
    ?.getAttribute("content");
  if (!value || value.startsWith("{{"))
    throw new Error(
      `offscreen.html carries no ${name}: the build did not write it`,
    );
  return value;
}
const origin = meta("equin-origin");

// ── The relay ───────────────────────────────────────────────────────────────

type Relay = (
  req: DistributiveOmit<RelayRequest, "id">,
  transfer?: Transferable[],
) => Promise<unknown>;
type DistributiveOmit<T, K extends keyof T> = T extends unknown
  ? Omit<T, K>
  : never;

let relay: Promise<Relay> | null = null;
/** The port's client in use; replaced when the relay page says hello again. */
let current: RelayClient | null = null;

interface RelayClient {
  call: Relay;
  /** Fail every request still waiting: the page that held them is gone. */
  drop: (why: Error) => void;
}

/**
 * The relay page's port, framing it on first use. The page holds its reload
 * while it lives; if it reloads anyway (a crash, a hard reload), its new hello
 * gets a new port and every request the old one held fails — loudly, never a
 * request left waiting on a dead port.
 */
function openRelay(): Promise<Relay> {
  if (relay !== null) return relay;
  relay = new Promise<Relay>((resolve) => {
    const frame = document.createElement("iframe");
    frame.src = `${origin}${RECORDER_RELAY_PATH}?embed=1`;
    document.body.append(frame);
    window.addEventListener("message", (event) => {
      const target = frame.contentWindow;
      if (target === null || event.source !== target || event.origin !== origin)
        return;
      if (!BridgeHelloSchema.safeParse(event.data).success) return;
      const channel = new MessageChannel();
      target.postMessage(BRIDGE_PORT, origin, [channel.port2]);
      current?.drop(
        new Error("The recorder's relay page reloaded mid-upload."),
      );
      current = relayClient(channel.port1);
      resolve((req, transfer) => {
        if (current === null) throw new Error("The relay has no port.");
        return current.call(req, transfer);
      });
    });
  });
  return relay;
}

function relayClient(port: MessagePort): RelayClient {
  let nextId = 0;
  const waiting = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  port.onmessage = (event: MessageEvent<unknown>) => {
    const response = RelayResponseSchema.parse(event.data);
    const entry = waiting.get(response.id);
    if (entry === undefined)
      throw new Error(`relay answered an unknown request #${response.id}`);
    waiting.delete(response.id);
    if (response.ok) entry.resolve(response.value);
    else entry.reject(new Error(response.error));
  };
  return {
    call: (req, transfer = []) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        waiting.set(id, { resolve, reject });
        port.postMessage({ id, ...req }, transfer);
      }),
    drop: (why) => {
      for (const entry of waiting.values()) entry.reject(why);
      waiting.clear();
      port.close();
    },
  };
}

// ── The recording ───────────────────────────────────────────────────────────

interface Session {
  recorder: MediaRecorder;
  streams: MediaStream[];
  audio: AudioContext | null;
  video: HTMLVideoElement;
  recordingId: string;
  folder: string;
  width: number;
  height: number;
  seq: number;
  /** The chunks' uploads, in order: each waits for the one before. */
  uploads: Promise<void>;
  queuedBytes: number;
  failed: Error | null;
  /** Resolves once the recorder has handed over its last chunk. */
  stopped: Promise<void>;
}

let session: Session | null = null;

/** The running recording; none is a fault the worker must hear about. */
function recording(): Session {
  if (session === null)
    throw new Error("The offscreen recorder holds no recording.");
  return session;
}

/**
 * Keep the service worker awake while `work` runs (a finish can wait on the
 * ffmpeg install and a remux): an extension message resets its idle timer.
 */
async function keepingWorkerAwake<T>(work: Promise<T>): Promise<T> {
  const timer = window.setInterval(
    () => void chrome.runtime.sendMessage({ type: "offscreen.heartbeat" }),
    20_000,
  );
  try {
    return await work;
  } finally {
    window.clearInterval(timer);
  }
}

/** `chromeMediaSource` constraints: Chrome's own, not in the DOM types. */
function tabConstraints(
  streamId: string,
  size?: { width: number; height: number },
) {
  return {
    mandatory: {
      chromeMediaSource: "tab",
      chromeMediaSourceId: streamId,
      ...(size === undefined
        ? {}
        : {
            minWidth: size.width,
            maxWidth: size.width,
            minHeight: size.height,
            maxHeight: size.height,
            maxFrameRate: FRAME_RATE,
          }),
    },
  } as unknown as MediaTrackConstraints;
}

function pickMimeType(withAudio: boolean): string {
  const candidates = withAudio
    ? [
        "video/mp4;codecs=avc1.640033,mp4a.40.2",
        "video/mp4;codecs=avc1,mp4a.40.2",
      ]
    : ["video/mp4;codecs=avc1.640033", "video/mp4;codecs=avc1"];
  const type = candidates.find((t) => MediaRecorder.isTypeSupported(t));
  if (type === undefined)
    throw new Error(
      "This Chrome cannot record MP4 (H.264): update Chrome to 126 or later.",
    );
  return type;
}

async function start(
  cmd: Extract<OffscreenCommand, { type: "offscreen.start" }>,
): Promise<void> {
  if (session !== null) throw new Error("The offscreen recorder is busy.");
  const size = { width: cmd.width, height: cmd.height };
  const tab = await navigator.mediaDevices.getUserMedia({
    video: tabConstraints(cmd.streamId, size),
    audio: cmd.tabAudio ? tabConstraints(cmd.streamId) : false,
  });
  const streams = [tab];
  const [videoTrack] = tab.getVideoTracks();
  if (videoTrack === undefined)
    throw new Error("The tab capture has no video.");
  const settings = videoTrack.getSettings();
  if (settings.width !== size.width || settings.height !== size.height) {
    for (const t of tab.getTracks()) t.stop();
    throw new Error(
      `The capture is ${settings.width} × ${settings.height}, not ${size.width} × ${size.height}.`,
    );
  }

  // Tab capture mutes the tab; route its audio back out so the user still
  // hears it, and mix it with the microphone into the recorded track.
  let audio: AudioContext | null = null;
  const tracks: MediaStreamTrack[] = [videoTrack];
  if (cmd.tabAudio || cmd.mic) {
    audio = new AudioContext();
    // An offscreen document has no user gesture: resume it explicitly.
    await audio.resume();
    const mix = audio.createMediaStreamDestination();
    if (cmd.tabAudio && tab.getAudioTracks().length > 0) {
      const source = audio.createMediaStreamSource(
        new MediaStream(tab.getAudioTracks()),
      );
      source.connect(audio.destination);
      source.connect(mix);
    }
    if (cmd.mic) {
      const mic = await navigator.mediaDevices
        .getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        })
        .catch((err: unknown) => {
          throw new Error(
            `The microphone is not allowed (${errorText(err)}): turn Mic on in the panel to grant it.`,
          );
        });
      streams.push(mic);
      audio.createMediaStreamSource(mic).connect(mix);
    }
    tracks.push(...mix.stream.getAudioTracks());
  }
  const stream = new MediaStream(tracks);
  const mimeType = pickMimeType(tracks.length > 1);

  const video = document.createElement("video");
  video.muted = true;
  video.srcObject = new MediaStream([videoTrack]);
  await video.play();

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: Math.round(
      size.width * size.height * FRAME_RATE * 0.14,
    ),
    audioBitsPerSecond: 160_000,
  });
  const stopped = new Promise<void>((resolve) =>
    recorder.addEventListener("stop", () => resolve(), { once: true }),
  );
  // The file is created last: nothing that can still fail leaves one behind.
  const created = RelayCreatedSchema.parse(
    await (
      await openRelay()
    )({ op: "create", title: cmd.title }),
  );
  const s: Session = {
    recorder,
    streams,
    audio,
    video,
    recordingId: created.recordingId,
    folder: created.folder,
    width: size.width,
    height: size.height,
    seq: 0,
    uploads: Promise.resolve(),
    queuedBytes: 0,
    failed: null,
    stopped,
  };
  recorder.addEventListener("dataavailable", (event) => enqueue(s, event.data));
  videoTrack.addEventListener("ended", () =>
    report({ type: "offscreen.ended", reason: "track-ended", error: null }),
  );
  session = s;
  recorder.start(1000);
}

/** Queue one chunk's upload behind the ones before it. */
function enqueue(s: Session, chunk: Blob): void {
  if (chunk.size === 0 || s.failed !== null) return;
  s.queuedBytes += chunk.size;
  if (s.queuedBytes > MAX_QUEUED_BYTES) {
    fail(
      s,
      new Error(
        "equin is not taking the recording fast enough (is it running?).",
      ),
    );
    return;
  }
  const seq = s.seq++;
  s.uploads = s.uploads.then(async () => {
    if (s.failed !== null) return;
    const bytes = await chunk.arrayBuffer();
    try {
      await (
        await openRelay()
      )({ op: "chunk", recordingId: s.recordingId, seq, bytes }, [bytes]);
    } catch (err) {
      fail(s, err instanceof Error ? err : new Error(String(err)));
      return;
    }
    s.queuedBytes -= chunk.size;
  });
}

function fail(s: Session, err: Error): void {
  if (s.failed !== null) return;
  s.failed = err;
  report({ type: "offscreen.ended", reason: "error", error: err.message });
}

function report(event: OffscreenEvent): void {
  void chrome.runtime.sendMessage(event);
}

/** The recorder's last chunk handed over and uploaded; capture released. */
async function wind(s: Session): Promise<void> {
  if (s.recorder.state !== "inactive") s.recorder.stop();
  await s.stopped;
  await s.uploads;
  s.video.pause();
  for (const stream of s.streams) for (const t of stream.getTracks()) t.stop();
  await s.audio?.close();
}

function thumbnail(s: Session): string | null {
  if (s.video.videoWidth === 0) return null;
  const canvas = document.createElement("canvas");
  canvas.width = THUMB_WIDTH;
  canvas.height = Math.round(
    (THUMB_WIDTH * s.video.videoHeight) / s.video.videoWidth,
  );
  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;
  ctx.drawImage(s.video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

async function stop(
  durationMs: number,
  pointer: PointerTrack | null,
): Promise<SavedRecording> {
  const s = recording();
  // Taken at once: a second stop (⌥⇧R twice) finds nothing to stop.
  session = null;
  const thumb = thumbnail(s);
  await wind(s);
  if (s.failed !== null) throw s.failed;
  const finished = RelayFinishedSchema.parse(
    await keepingWorkerAwake(
      (async () =>
        (await openRelay())({
          op: "finish",
          recordingId: s.recordingId,
          durationMs,
          pointer,
        }))(),
    ),
  );
  return {
    ...finished,
    durationMs,
    width: s.width,
    height: s.height,
    thumbnail: thumb,
  };
}

async function discard(): Promise<void> {
  const s = recording();
  session = null;
  s.failed ??= new Error("discarded");
  await wind(s);
  await (
    await openRelay()
  )({ op: "discard", recordingId: s.recordingId });
}

onMessageAsync(
  (m) => {
    const type = messageType(m);
    return (
      type !== null &&
      type.startsWith("offscreen.") &&
      type !== "offscreen.ended"
    );
  },
  async (message): Promise<OffscreenReply> => {
    const cmd = OffscreenCommandSchema.parse(message);
    switch (cmd.type) {
      case "offscreen.start":
        await start(cmd);
        return { ok: true, saved: null };
      case "offscreen.pause":
        recording().recorder.pause();
        return { ok: true, saved: null };
      case "offscreen.resume":
        recording().recorder.resume();
        return { ok: true, saved: null };
      case "offscreen.stop":
        return { ok: true, saved: await stop(cmd.durationMs, cmd.pointer) };
      case "offscreen.discard":
        await discard();
        return { ok: true, saved: null };
    }
  },
);
