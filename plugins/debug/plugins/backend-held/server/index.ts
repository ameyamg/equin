import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { backendHeldKind } from "./internal/backend-held-kind";

export default {
  description:
    "The backend-held report kind — filed by the gateway through the report outbox when a connection keeps a non-always-on backend up for nobody — silent (no request completed and no byte crossing it for an hour) or kept-alive (a WebSocket that alone kept it up six hours with no request) —, drained by main: the connection (HTTP or WebSocket, method, path, User-Agent, fetch metadata, remote address, bytes, how long open and quiet).",
  contributions: [backendHeldKind],
} satisfies ServerPluginDefinition;
