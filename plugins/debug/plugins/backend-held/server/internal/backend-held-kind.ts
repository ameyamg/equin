import { ReportKind } from "@plugins/reports/server";
import type { ReportRow } from "@plugins/reports/server";
import { gatewayLogs } from "@plugins/infra/plugins/launcher/plugins/gateway-logs/data-dirs";
import {
  BackendHeldPayloadSchema,
  describeBackendHeld,
  formatHeldDuration,
  type BackendHeldPayload,
} from "../../core";

// The `backend-held` kind, filed by the gateway (connections_report.go)
// through the report outbox when a connection keeps a non-always-on backend
// up for nobody: silent (nothing crossed it for an hour) or kept-alive (a
// connection that alone kept it up six hours with no request). One row per
// culprit — the rule, the kind of connection, its method and path — so the
// same stuck client holding five backends up is one row counted five times.
export const backendHeldKind = ReportKind({
  kind: "backend-held",
  schema: BackendHeldPayloadSchema,
  fingerprint: (d: BackendHeldPayload) =>
    `backend-held:${d.reason}:${d.connection.kind}:${d.connection.method} ${d.connection.path}`,
  meta: {
    tag: "[backend-held]",
    notif: "A backend is held up by a connection nobody uses",
    variant: "warning",
    category: "error",
  },
  renderTask: (row: ReportRow) => {
    const d = BackendHeldPayloadSchema.parse(row.data);
    return {
      title: `[backend-held] ${describeBackendHeld(d)}`,
      description: renderDescription(row, d),
    };
  },
});

function at(ms: number): string {
  return ms > 0 ? new Date(ms).toISOString() : "never";
}

function renderDescription(row: ReportRow, d: BackendHeldPayload): string {
  const c = d.connection;
  const lines: string[] = [];
  lines.push(`**${describeBackendHeld(d)}**`);
  lines.push("");
  lines.push(
    `The gateway never sweeps a backend with an open connection. \`${d.worktree}\` ` +
      `has had no request completed since ${at(d.lastActivityAt)} (its idle timeout is ` +
      `${formatHeldDuration(d.idleTimeoutMs)}), and the connection below has kept it up.`,
  );
  lines.push("");
  lines.push(
    d.reason === "silent"
      ? `**Silent:** it has moved no byte, either way, for ${formatHeldDuration(c.quietForMs)}. ` +
          `A live WebSocket moves bytes every couple of minutes (Bun pings it, the live-state ` +
          `client heartbeats every 20 s), and a streaming response writes as it goes, so this ` +
          `one is stuck: a request its backend never answered, or a peer that is gone or frozen.`
      : `**Kept alive:** a ${c.kind} connection open ${formatHeldDuration(c.openForMs)} that ` +
          `alone has kept the backend up for over ${formatHeldDuration(d.heldAfterMs)} with not ` +
          `one request completed. Its client is alive (it answers pings, or reads a stream that ` +
          `keeps writing), so at the gateway it looks like a use — yet nothing has been asked of ` +
          `the backend all that time: a forgotten tab, a leaked client, or a backend holding a ` +
          `stream to itself. The User-Agent and remote address say which.`,
  );
  lines.push("");
  lines.push("**The connection:**");
  lines.push("");
  lines.push(`- ${c.kind} \`${c.method} ${c.host}${c.path}\` (#${c.id})`);
  lines.push(
    `- from \`${c.remoteAddr}\`, principal \`${c.principal || "(none)"}\``,
  );
  lines.push(`- User-Agent: \`${c.userAgent || "(none)"}\``);
  lines.push(
    `- Origin \`${c.origin || "(none)"}\`, Sec-Fetch-Site \`${c.secFetchSite || "(none)"}\`, ` +
      `Mode \`${c.secFetchMode || "(none)"}\`, Dest \`${c.secFetchDest || "(none)"}\``,
  );
  lines.push(
    `- open since ${at(c.openedAt)} (${formatHeldDuration(c.openForMs)}); ` +
      `${c.bytesIn} B in, ${c.bytesOut} B out; last byte ${at(c.lastByteAt)}`,
  );
  lines.push(
    `- the backend had ${d.openConnections} connection(s) open in all`,
  );
  lines.push("");
  lines.push(
    `**What to do:** \`GET /gateway/connections?worktree=${d.worktree}\` lists what is ` +
      `open on it now. While the client lives, \`lsof -nP -iTCP:${c.remoteAddr.split(":").pop()}\` ` +
      `names the process on the other end. Fix the client (or the route that never answers), ` +
      `not the sweeper. The gateway logs each one at warn in ` +
      `\`${gatewayLogs.file("gateway.log")}\` (\`backend held up by a connection\`).`,
  );
  lines.push("");
  lines.push(`**Occurrences:** ${row.count}`);
  lines.push(`**First seen:** ${row.firstSeenAt.toISOString()}`);
  lines.push(`**Last seen:** ${row.lastSeenAt.toISOString()}`);
  return lines.join("\n");
}
