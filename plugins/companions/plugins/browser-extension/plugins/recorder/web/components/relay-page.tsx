import { useEffect, useSyncExternalStore } from "react";
import {
  acceptBridgePort,
  BRIDGE_HELLO,
  EXTENSION_ORIGIN,
  RelayRequestSchema,
  type RelayRequest,
  type RelayResponse,
} from "@plugins/companions/plugins/browser-extension/core";
import {
  useFetchEndpoint,
  type FetchEndpoint,
} from "@plugins/infra/plugins/endpoints/web";
import { report } from "@plugins/reports/web";
import { crashFieldsOf } from "@plugins/packages/plugins/error-subject/core";
import {
  EndpointError,
  EndpointNetworkError,
  type MachineResult,
} from "@plugins/infra/plugins/endpoints/core";
import { useLive } from "@plugins/network/plugins/live/web";
import { useReloadHold } from "@plugins/primitives/plugins/dom/plugins/reload-readiness/web";
import { Center } from "@plugins/primitives/plugins/css/plugins/center/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import {
  appendTabRecordingChunk,
  createTabRecording,
  discardTabRecording,
  finishTabRecording,
  recordingSave,
  type RecordingSaveOutcome,
} from "../../core";

/**
 * The recorder's relay (`/home/browser-extension-recorder`): the page the
 * extension's offscreen document frames, hidden, to upload a recording. A
 * fetch from the extension's origin reaches the gateway as anonymous; this
 * page is equin's own, so its requests are the owner's. It says hello to its
 * parent, takes a port only from the extension's origin (`acceptBridgePort`),
 * and answers each request on it with the endpoint's response — one at a
 * time, in the order they come (the offscreen side sends chunks serially).
 * Opened in a plain tab it does nothing and says what it is.
 */
export function RecorderRelayPage() {
  const fetchEndpoint = useFetchEndpoint();
  // The page lives as long as one recording's offscreen document: an update
  // reload mid-upload would cut the port the recording streams through.
  useReloadHold(true, { label: "Uploading a tab recording" });
  useEffect(() => {
    // Opened in a plain tab, there is no recorder to serve.
    if (window.parent === window) return;
    let port: MessagePort | null = null;
    const onMessage = (event: MessageEvent<unknown>) => {
      const accepted = acceptBridgePort(
        {
          origin: event.origin,
          source: event.source,
          data: event.data,
          ports: event.ports,
        },
        window.parent,
      );
      if (accepted === null) return;
      port?.close();
      port = accepted;
      const served = accepted;
      served.onmessage = (m: MessageEvent<unknown>) =>
        void serve(served, fetchEndpoint, m.data);
    };
    window.addEventListener("message", onMessage);
    window.parent.postMessage(BRIDGE_HELLO, EXTENSION_ORIGIN);
    return () => {
      window.removeEventListener("message", onMessage);
      port?.close();
    };
  }, [fetchEndpoint]);
  const waits = useSyncExternalStore(
    saveWaits.subscribe,
    saveWaits.read,
    saveWaits.read,
  );
  return (
    <Center className="size-full">
      <Text tone="muted">
        The browser extension’s recorder uploads through this page.
      </Text>
      {waits.map((id) => (
        <SaveWait key={id} id={id} />
      ))}
    </Center>
  );
}

/**
 * The saves a finish waits on, by recording id: `RecorderRelayPage` renders a
 * `SaveWait` per id, which reads the save's live value and settles the wait
 * once the save job ended. A backend restarting mid-save only makes the wait
 * longer: the live value reconnects, the job re-runs.
 */
const saveWaits = (() => {
  const waiting = new Map<string, (outcome: RecordingSaveOutcome) => void>();
  let ids: string[] = [];
  const listeners = new Set<() => void>();
  const changed = () => {
    ids = [...waiting.keys()];
    for (const l of listeners) l();
  };
  return {
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read: () => ids,
    wait: (id: string) =>
      new Promise<RecordingSaveOutcome>((resolve) => {
        waiting.set(id, resolve);
        changed();
      }),
    /** The finish was not asked for after all: nobody waits on it. */
    drop: (id: string) => {
      if (waiting.delete(id)) changed();
    },
    settle: (id: string, outcome: RecordingSaveOutcome) => {
      const resolve = waiting.get(id);
      if (resolve === undefined) return;
      waiting.delete(id);
      changed();
      resolve(outcome);
    },
  };
})();

function SaveWait({ id }: { id: string }) {
  const read = useLive(recordingSave, { id });
  const outcome =
    read.status === "ready" && read.data.state !== "pending" ? read.data : null;
  useEffect(() => {
    if (outcome !== null) saveWaits.settle(id, outcome);
  }, [id, outcome]);
  // A failed read is loud: the page's error boundary says it.
  if (read.status === "error") throw read.error;
  return null;
}

/**
 * equin did not answer — no response (the backend switching on redeploy),
 * or the gateway answered for it (502 / 503 / 504, its own page): the
 * extension sends the same request again. Anything else is equin's answer.
 */
function isUnavailable(err: unknown): boolean {
  if (err instanceof EndpointNetworkError) return true;
  return err instanceof EndpointError && [502, 503, 504].includes(err.status);
}

async function serve(
  port: MessagePort,
  fetchEndpoint: FetchEndpoint,
  data: unknown,
): Promise<void> {
  const parsed = RelayRequestSchema.safeParse(data);
  if (!parsed.success) {
    const id =
      typeof data === "object" && data !== null && "id" in data
        ? Number((data as { id: unknown }).id)
        : -1;
    port.postMessage({
      id,
      ok: false,
      error: `not a relay request: ${parsed.error.message}`,
      retry: false,
    } satisfies RelayResponse);
    return;
  }
  const req = parsed.data;
  let response: RelayResponse;
  try {
    response = { id: req.id, ok: true, value: await relay(fetchEndpoint, req) };
  } catch (err) {
    const retry = isUnavailable(err);
    response = {
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      retry,
    };
    // Mid-recording: a chunk or finish equin refused cuts a recording short.
    // A create that fails (no Recordings folder, no computer) is said at
    // Record; one equin did not answer is sent again.
    if (!retry && (req.op === "chunk" || req.op === "finish"))
      reportRelayFailure(req, err);
  }
  port.postMessage(response);
}

/**
 * A chunk or finish that failed is never expected control flow, whatever its
 * status: it stops the recording early (the extension saves what was
 * uploaded). So the relay files it as a crash —
 * the generic endpoint reporter cannot tell a 404 here from a 404 a caller
 * handles.
 */
function reportRelayFailure(req: RelayRequest, err: unknown): void {
  void report({
    kind: "crash",
    source: "client-tab-recorder",
    message: `Tab recording ${req.op} failed: ${err instanceof Error ? err.message : String(err)}`,
    url: window.location.href,
    userAgent: navigator.userAgent,
    data: crashFieldsOf(err, `tab-recording ${req.op}`),
  });
}

/** A machine endpoint's answer, or a throw saying why this host has none. */
function machineValue<T>(result: MachineResult<T>): T {
  if (result.kind === "unavailable") throw new Error(result.message);
  return result.value;
}

async function relay(
  fetchEndpoint: FetchEndpoint,
  req: RelayRequest,
): Promise<unknown> {
  switch (req.op) {
    case "create":
      return machineValue(
        await fetchEndpoint(
          createTabRecording,
          {},
          { body: { title: req.title } },
        ),
      );
    case "chunk":
      return machineValue(
        await fetchEndpoint(
          appendTabRecordingChunk,
          { id: req.recordingId, seq: String(req.seq) },
          { body: new Blob([req.bytes], { type: "video/mp4" }) },
        ),
      );
    case "finish": {
      // Waiting first: an outcome landing between the request and the wait
      // is still read (the live value holds it).
      const saved = saveWaits.wait(req.recordingId);
      try {
        machineValue(
          await fetchEndpoint(
            finishTabRecording,
            { id: req.recordingId },
            { body: { durationMs: req.durationMs, pointer: req.pointer } },
          ),
        );
      } catch (err) {
        saveWaits.drop(req.recordingId);
        throw err;
      }
      const outcome = await saved;
      if (outcome.state === "failed") throw new Error(outcome.error);
      const { path, folder, name, bytes } = outcome;
      return { path, folder, name, bytes };
    }
    case "discard":
      machineValue(
        await fetchEndpoint(discardTabRecording, { id: req.recordingId }, {}),
      );
      return null;
  }
}
