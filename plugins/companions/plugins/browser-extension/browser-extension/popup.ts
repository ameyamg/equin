/**
 * The extension's popup: frames the equin page (`/home/browser-extension`)
 * and serves its bridge calls with what only an extension has — the tabs and
 * the popup itself. It never calls equin: everything equin does
 * runs inside the frame, same-origin with its server.
 *
 * Bundled by the build (`cli/internal/write-shell.ts`), which writes the equin
 * origin and this shell's digest into `popup.html`. The contract is
 * `core/bridge.ts`.
 */
import {
  BRIDGE_PORT,
  BridgeHelloSchema,
  BridgeRequestSchema,
  type BridgeCall,
  type BridgeEvent,
  type BridgeResponse,
  type ExtensionHostInfo,
} from "../core/bridge";
import {
  WorkerReplySchema,
  type MicPermission,
  type RecorderCommand,
  type RecorderSnapshot,
  type TabFit,
  type WorkerCommand,
} from "../core/recorder";
import {
  chrome,
  errorText,
  hasApis,
  runsThisBuild,
  sendToExtension,
  SHELL_BUILD,
  type ChromeTab,
} from "./chrome-api";
import { measureTab } from "./measure";
import {
  record,
  startPopupTrace,
  takePreviousTrace,
  tracePopupLifecycle,
} from "./popup-trace";
import {
  OPTIONS_KEY,
  readRecorderOptions,
  readRecorderState,
  STATE_KEY,
  writeRecorderOptions,
} from "./recorder-store";

/** Chrome's own cap on a popup's height. */
const MAX_HEIGHT = 600;

function meta(name: string): string {
  const value = document
    .querySelector(`meta[name="${name}"]`)
    ?.getAttribute("content");
  if (!value || value.startsWith("{{"))
    throw new Error(
      `popup.html carries no ${name}: the build did not write it`,
    );
  return value;
}

/**
 * The shell that is actually running: this build's digest while Chrome runs
 * the manifest it was built with — the manifest names the whole shell's
 * digest, so a build that changed any part of it (a permission, the service
 * worker, the offscreen recorder) is a new manifest. Under an older one, not
 * this shell: an unpacked extension reads the popup's files from disk on
 * every open but the manifest and the worker only when (re)loaded, so the
 * page, seeing this digest differ from the served one, asks Chrome to reload
 * the extension (`web/internal/shell-update.tsx`), its usual self-update.
 */
const shellDigest = runsThisBuild()
  ? SHELL_BUILD
  : `${SHELL_BUILD}+stale-manifest`;

// The trace first: a popup Chrome closes at once must still leave one.
startPopupTrace(shellDigest);

const origin = meta("equin-origin");

const frame = document.createElement("iframe");
tracePopupLifecycle(frame);
frame.src = `${origin}/home/browser-extension?embed=1`;
frame.title = "equin";
document.body.append(frame);

// The bridge first, before anything else this script does: it is how the
// page reaches the shell at all — and how it asks a stale shell to reload —
// so nothing a newer build adds below may stand between the page and it.
// (2026-11-25: a top-level chrome.storage call threw under the older
// manifest Chrome still held, before this listener, and the popover stayed
// blank with no way to update itself.)
// The page says hello once it listens (a reload says it again); each hello
// from our own frame, at the equin origin, gets a fresh port.
window.addEventListener("message", (event) => {
  const target = frame.contentWindow;
  if (target === null || event.source !== target || event.origin !== origin)
    return;
  if (!BridgeHelloSchema.safeParse(event.data).success) return;
  record("hello");
  const channel = new MessageChannel();
  channel.port1.onmessage = (m) => void serve(channel.port1, m.data);
  target.postMessage(BRIDGE_PORT, origin, [channel.port2]);
});

/**
 * The tab the popup is about. Opened from the toolbar the popup is no tab, so
 * it is the active one; opened as a tab of its own (a test, a debugging
 * session), it is the most recently used tab that is not the popup.
 */
async function aboutTab(): Promise<ChromeTab & { id: number }> {
  const self = await chrome.tabs.getCurrent();
  const others = (await chrome.tabs.query({ lastFocusedWindow: true })).filter(
    (t) => t.id !== undefined && t.id !== self?.id,
  );
  const tab =
    others.find((t) => t.active) ??
    [...others].sort(
      (a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0),
    )[0];
  if (tab?.id === undefined) throw new Error("There is no tab to act on.");
  return { ...tab, id: tab.id };
}

const hostInfo: ExtensionHostInfo = {
  version: 1,
  shellDigest,
  capabilities: {
    activeTab: true,
    navigate: true,
    openTab: true,
    close: true,
    // Only where the loaded manifest grants what the recorder uses.
    record: hasApis("storage", "scripting", "tabCapture", "offscreen"),
    trace: true,
  },
};

// ── The recorder: commands go to the worker, state comes back by push ──────

async function toWorker(command: WorkerCommand): Promise<void> {
  const reply = WorkerReplySchema.parse(await sendToExtension(command));
  if (!reply.ok) throw new Error(reply.error);
}

const WORKER_COMMAND: Record<
  RecorderCommand,
  Exclude<WorkerCommand, { type: "recorder.start" | "recorder.apply-size" }>
> = {
  stop: { type: "recorder.stop" },
  pause: { type: "recorder.pause" },
  resume: { type: "recorder.resume" },
  discard: { type: "recorder.discard" },
  "forget-last": { type: "recorder.forget-last" },
};

async function micPermission(): Promise<MicPermission> {
  const status = await navigator.permissions.query({
    name: "microphone" as PermissionName,
  });
  return status.state;
}

async function recorderSnapshot(): Promise<RecorderSnapshot> {
  return {
    state: await readRecorderState(),
    options: await readRecorderOptions(),
    mic: await micPermission(),
  };
}

async function tabFit(): Promise<TabFit> {
  const tab = await aboutTab();
  try {
    return { kind: "measured", measure: await measureTab(tab.id) };
  } catch (err) {
    // Chrome lets no extension script its own pages (chrome://, the Web
    // Store): those tabs cannot be recorded, and the panel says so.
    return { kind: "unrecordable", reason: errorText(err) };
  }
}

/** Ports that asked for the recorder: each change is pushed to them. */
const recorderPorts = new Set<MessagePort>();

function pushRecorder(): void {
  if (recorderPorts.size === 0) return;
  void recorderSnapshot().then((value) => {
    const event: BridgeEvent = { event: "recorder", value };
    for (const port of recorderPorts) port.postMessage(event);
  });
}

chrome.storage?.onChanged.addListener((changes) => {
  if (STATE_KEY in changes || OPTIONS_KEY in changes) pushRecorder();
});

async function answer(call: BridgeCall, port: MessagePort): Promise<unknown> {
  switch (call.method) {
    case "hostInfo":
      return hostInfo;
    case "activeTab": {
      const tab = await aboutTab();
      return { url: tab.url ?? "", title: tab.title ?? "" };
    }
    case "navigate":
      await chrome.tabs.update((await aboutTab()).id, { url: call.params.url });
      return null;
    case "openTab":
      await chrome.tabs.create({
        url: call.params.url,
        active: call.params.background !== true,
      });
      return null;
    case "close":
      record("close-call");
      window.close();
      return null;
    case "setHeight":
      record("set-height", String(call.params.px));
      frame.style.height = `${Math.min(call.params.px, MAX_HEIGHT)}px`;
      return null;
    case "reload":
      record("reload-call");
      chrome.runtime.reload();
      return null;
    case "recorder":
      recorderPorts.add(port);
      return recorderSnapshot();
    case "recorderFit":
      return tabFit();
    case "recorderStart":
      await writeRecorderOptions(call.params.options);
      await toWorker({
        type: "recorder.start",
        tabId: (await aboutTab()).id,
        options: call.params.options,
      });
      return null;
    case "recorderOptions":
      await writeRecorderOptions(call.params.options);
      return null;
    case "recorderCommand":
      await toWorker(WORKER_COMMAND[call.params.command]);
      return null;
    case "recorderApplySize":
      await toWorker({
        type: "recorder.apply-size",
        tabId: (await aboutTab()).id,
        preset: call.params.preset,
      });
      return null;
    case "requestMicrophone":
      await chrome.tabs.create({
        url: chrome.runtime.getURL("permissions.html"),
      });
      return null;
    case "lastPopupTrace":
      return takePreviousTrace();
  }
}

async function serve(port: MessagePort, data: unknown): Promise<void> {
  const parsed = BridgeRequestSchema.safeParse(data);
  if (!parsed.success) {
    const id =
      typeof data === "object" && data !== null && "id" in data
        ? Number((data as { id: unknown }).id)
        : -1;
    const refusal: BridgeResponse = {
      id,
      ok: false,
      error: `The extension does not know this call (the page is newer than the extension: reload it). ${errorText(parsed.error)}`,
    };
    port.postMessage(refusal);
    return;
  }
  const { id, ...call } = parsed.data;
  let response: BridgeResponse;
  try {
    response = { id, ok: true, value: await answer(call as BridgeCall, port) };
  } catch (err) {
    response = { id, ok: false, error: errorText(err) };
  }
  port.postMessage(response);
}
