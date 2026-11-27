import { z } from "zod";

// The jsonb payload of a `backend-held` report. Written by the GATEWAY (Go,
// gateway/connections_report.go `backendHeld`, its connection a
// gateway/connections.go `ConnStatus`) into the report outbox, so this schema
// is a cross-language contract: gateway/testdata/backend-held-entry.json is
// what the Go writer produces, and kind.test.ts parses it with this schema.
// Strict: a field the Go writer adds must be added here too.
export const HeldConnectionSchema = z.strictObject({
  /** Numbers connections across the gateway's life. */
  id: z.number().int(),
  kind: z.enum(["http", "websocket"]),
  method: z.string(),
  host: z.string(),
  /** The path only, never the query. */
  path: z.string(),
  userAgent: z.string(),
  origin: z.string(),
  secFetchSite: z.string(),
  secFetchMode: z.string(),
  secFetchDest: z.string(),
  /** The X-Equin-Principal the gateway stamped on it. */
  principal: z.string(),
  /** The client's address: its port names the client process (`lsof -iTCP:<port>`) while it lives. */
  remoteAddr: z.string(),
  /** Epoch ms; lastByteAt 0 when no byte ever crossed it. */
  openedAt: z.number(),
  openForMs: z.number(),
  /** Client → backend, backend → client. */
  bytesIn: z.number().int().nonnegative(),
  bytesOut: z.number().int().nonnegative(),
  lastByteAt: z.number(),
  quietForMs: z.number(),
});
export type HeldConnection = z.infer<typeof HeldConnectionSchema>;

export const BackendHeldPayloadSchema = z.strictObject({
  worktree: z.string(),
  /**
   * Which rule: `silent` — no byte either way on the connection for
   * heldAfterMs; `kept-alive` — a WebSocket, traffic or not, that alone kept
   * the backend up for heldAfterMs with no request completed.
   */
  reason: z.enum(["silent", "kept-alive"]),
  /** Epoch ms of the latest request completed (or WebSocket opened) on the backend. */
  lastActivityAt: z.number(),
  idleTimeoutMs: z.number(),
  /** The threshold: no request completed and nothing on the connection for this long. */
  heldAfterMs: z.number(),
  connection: HeldConnectionSchema,
  /** How many connections the backend had open in all. */
  openConnections: z.number().int().positive(),
  detectedAt: z.number(),
});
export type BackendHeldPayload = z.infer<typeof BackendHeldPayloadSchema>;

function hours(ms: number): string {
  const h = ms / 3_600_000;
  return h >= 1 ? `${h.toFixed(1)} h` : `${Math.round(ms / 60_000)} min`;
}

/** One line: `promo-film.x held up 5.0 h by a silent websocket GET /ws/notifications`. */
export function describeBackendHeld(d: BackendHeldPayload): string {
  const c = d.connection;
  return `${d.worktree} held up ${hours(d.detectedAt - d.lastActivityAt)} by a ${d.reason} ${c.kind} ${c.method} ${c.path}`;
}

/** How long, in words, for the evidence: `5.0 h`. */
export const formatHeldDuration = hours;
