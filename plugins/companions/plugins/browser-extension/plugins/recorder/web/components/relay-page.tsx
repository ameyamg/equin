import { useEffect } from "react";
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
import type { MachineResult } from "@plugins/infra/plugins/endpoints/core";
import { useReloadHold } from "@plugins/primitives/plugins/dom/plugins/reload-readiness/web";
import { Center } from "@plugins/primitives/plugins/css/plugins/center/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import {
  appendTabRecordingChunk,
  createTabRecording,
  discardTabRecording,
  finishTabRecording,
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
  return (
    <Center className="size-full">
      <Text tone="muted">
        The browser extension’s recorder uploads through this page.
      </Text>
    </Center>
  );
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
    } satisfies RelayResponse);
    return;
  }
  const req = parsed.data;
  let response: RelayResponse;
  try {
    response = { id: req.id, ok: true, value: await relay(fetchEndpoint, req) };
  } catch (err) {
    response = {
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  port.postMessage(response);
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
    case "finish":
      return machineValue(
        await fetchEndpoint(
          finishTabRecording,
          { id: req.recordingId },
          { body: { durationMs: req.durationMs, pointer: req.pointer } },
        ),
      );
    case "discard":
      machineValue(
        await fetchEndpoint(discardTabRecording, { id: req.recordingId }, {}),
      );
      return null;
  }
}
