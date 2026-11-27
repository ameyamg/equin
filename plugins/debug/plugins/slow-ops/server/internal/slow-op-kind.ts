import { ReportKind } from "@plugins/reports/server";
import type { ReportRow } from "@plugins/reports/server";
import { debugApp } from "@plugins/apps/plugins/debug/plugins/shell/core";
import { traceDetailRoute } from "@plugins/debug/plugins/trace/plugins/engine/core";
import {
  isLegacyBurstReport,
  SlowOpReportPayloadSchema,
  type SlowOpReportPayload,
} from "../../core";
import { TRANSPORT_LAYER } from "../../shared/endpoints";
import { describeWaits } from "./wait-layers";
import {
  memorySection,
  stacksSection,
} from "@plugins/reports/plugins/main-thread-stall/plugins/tab-evidence/core";

// The slow-op report kind. Dedups per distinct `${operationKind}:${operation}`,
// so each slow operation gets its own report pointing straight at the offending op
// — keeping its own count, caller history, and context — while distinct slow ops
// get distinct reports (a slow loader for resource X is a different bug than a slow
// HTTP route Y). The live ranked breakdown across all ops still lives in the
// slow_ops store / Debug → Slow Ops; each report drills into one of them.
export const slowOpKind = ReportKind({
  kind: "slow-op",
  schema: SlowOpReportPayloadSchema,
  fingerprint: (d: SlowOpReportPayload) =>
    `slow-op:${d.operationKind}:${d.operation}`,
  meta: {
    tag: "[slow-op]",
    notif: "Slow operation detected",
    variant: "warning",
    category: "slow-op",
    // No notifCooldownMs, unlike most sibling kinds: a slow op is a recurring
    // metric, so it wants the SHORTEST re-alert the engine allows — which is
    // the engine's own floor. It used to name 60 s here; the floor is 10
    // minutes, so that number bought nothing and only read as if it did. This
    // is the noisiest kind in the table, and quieter is the right direction
    // for it anyway.
  },
  renderTask: (row: ReportRow) => {
    const d = SlowOpReportPayloadSchema.parse(row.data);
    const coldStartSuffix = d.transportColdStart
      ? " — transport cold-start"
      : "";
    const what = isLegacyBurstReport(d)
      ? `${d.operationKind} burst of ${d.burst.count} (slowest ${d.burst.operations[0]?.operation ?? "?"})`
      : `${d.operationKind} ${d.operation}` +
        (d.burst ? ` (1 of ${d.burst.count} at once)` : "");
    const waiting =
      d.waitingFor !== undefined && d.waitingFor.length > 0
        ? ` — ${d.censored ? "waiting for" : "last to answer"} ${d.waitingFor.join(", ")}`
        : "";
    return {
      title: `[slow-op] ${what} — ${d.censored ? "not done after " : ""}${timeLabel(d)}${coldStartSuffix}${waiting}`,
      description: renderDescription(row, d),
    };
  },
});

/** `1502ms own of 2500ms` when time was excluded, else the one duration. */
function timeLabel(d: SlowOpReportPayload): string {
  const wall = Math.round(d.durationMs);
  if (d.ownMs === undefined || Math.round(d.ownMs) === wall) return `${wall}ms`;
  return `${Math.round(d.ownMs)}ms own of ${wall}ms`;
}

/**
 * The per-op findings seen while the person waited (D26 step 3): each would
 * have been a report of its own; here they are this wait's evidence, largest
 * first, timed from the wait's start.
 */
function findingsSection(
  f: NonNullable<SlowOpReportPayload["findings"]>,
  startedAtMs: number | undefined,
): string[] {
  const via = {
    tab: "this tab, during the wait",
    restart: "the server, in its restart replay",
    window: "the server, inside the wait's window",
  } as const;
  const out = [
    `**Evidence — per-op findings while the person waited** (${f.total}` +
      (f.total > f.items.length
        ? `, the ${f.items.length} largest shown`
        : "") +
      `; none of these filed a report of its own unless linked):`,
  ];
  for (const x of f.items) {
    const at =
      startedAtMs !== undefined
        ? ` at +${((x.startMs - startedAtMs) / 1000).toFixed(1)}s`
        : "";
    out.push(
      `- [${x.source}] ${x.what}${at} — ${via[x.via]}` +
        (x.reportId !== undefined ? ` (filed: \`${x.reportId}\`)` : ""),
    );
  }
  out.push(
    "",
    "Start from the largest shared cause among them (a gate, a boot hook, the " +
      "replay itself) rather than any one read.",
  );
  return out;
}

function renderDescription(row: ReportRow, d: SlowOpReportPayload): string {
  const lines: string[] = [];
  if (d.burst) {
    const legacy = isLegacyBurstReport(d);
    // The ops it tripped with: every named one but itself (a legacy row names
    // the whole batch); the rest of the batch counted, not named.
    const listed = legacy
      ? d.burst.operations
      : d.burst.operations.filter((o) => o.operation !== d.operation);
    const unnamed = d.burst.count - (legacy ? 0 : 1) - listed.length;
    lines.push(
      legacy
        ? `${d.burst.count} \`${d.operationKind}\` operations exceeded their ` +
            `slow-op threshold in the same instant (one batch), filed as one ` +
            `report. Its numbers are the slowest one's.`
        : `This op tripped with ${d.burst.count - 1} other ` +
            `\`${d.operationKind}\` operation(s) in the same instant (one ` +
            `batch) — likely one incident, which rang the bell once while each ` +
            `op kept its own report. Look for what they share (the tab, its ` +
            `socket, its boot, a server stall) before blaming this one; if it ` +
            `trips alone too, it is slow on its own.`,
    );
    lines.push("");
    lines.push(
      `**Tripped with (slowest first):** ` +
        listed.map((o) => `\`${o.operation}\` ${o.ownMs}ms`).join(", ") +
        (unnamed > 0 ? `, +${unnamed} more` : "") +
        ".",
    );
    lines.push("");
  }
  const named = isLegacyBurstReport(d)
    ? (d.burst.operations[0]?.operation ?? d.operation)
    : d.operation;
  lines.push(
    `The \`${d.operationKind}\` operation \`${named}\` has been exceeding ` +
      `its configured slow-op threshold of ${d.thresholdMs}ms.`,
  );
  lines.push("");
  lines.push(`**Operation:** \`${d.operationKind}\` \`${d.operation}\``);
  lines.push(
    `**Latest duration:** ${d.censored ? "still not done after " : ""}${timeLabel(d)}`,
  );
  if (d.waitingFor !== undefined && d.waitingFor.length > 0) {
    lines.push("");
    const names = d.waitingFor.map((k) => `\`${k}\``).join(", ");
    lines.push(
      d.censored
        ? `**Still waiting for:** ${names} — the live reads on screen with no ` +
            `answer yet when it was filed (most waited first; \`×n\` is n ` +
            `readers of one resource). Start there: why has each not answered ` +
            `(its loader, its gate, the socket)?`
        : `**Last to answer:** ${names} — the load finished past its budget, ` +
            `so this is the read that held it last. A load quiet at the budget ` +
            `(its reads not mounted yet: a slow bundle, lazy app code) is filed ` +
            `when it ends; check the boot trace for where the time before its ` +
            `reads went.`,
    );
  }
  if (d.ownMs !== undefined && Math.round(d.ownMs) !== Math.round(d.durationMs))
    lines.push(
      `Judged on its own time: the rest was spent not working (queued on a ` +
        `gate, held by a declared throttle, a frozen or hidden page, machine ` +
        `sleep, or inside another op already filed on its own) — see the ` +
        `layers below.`,
    );
  lines.push(`**Threshold:** ${d.thresholdMs}ms`);
  if (d.transportColdStart) {
    const socketMs = d.waits?.[TRANSPORT_LAYER] ?? d.transportWaitMs;
    const waited =
      socketMs !== undefined
        ? ` (waited ~${Math.round(socketMs)}ms for the socket)`
        : "";
    lines.push("");
    lines.push(
      `**Cold start:** the notifications transport was not ready when this ` +
        `resource mounted${waited}. That wait is not counted against the ` +
        `resource — it is filed on its own, as \`wait ${TRANSPORT_LAYER}\` — so ` +
        `this report is about what remained.`,
    );
  }
  const waitLines = describeWaits(d);
  if (waitLines.length > 0) lines.push("", ...waitLines);
  if (d.findings !== undefined && d.findings.total > 0)
    lines.push("", ...findingsSection(d.findings, d.startedAtMs));
  if (d.evidence) {
    // A long frame the tab lived through: what ran beneath its entry point.
    lines.push("", ...stacksSection(d.evidence.stacks, d.durationMs, "frame"));
    lines.push("", ...memorySection(d.evidence.memory, "frame"));
  }
  if (d.traceId) {
    lines.push("");
    lines.push(
      `**Trace:** the coherent-instant flight window (spans / gates / contention) ` +
        `captured for this trip is at \`${traceDetailRoute.link(debugApp, { id: d.traceId })}\` ` +
        `(Debug → Slow Events).`,
    );
  }
  lines.push("");
  lines.push(
    "See this op's full ranked breakdown — total time, max, and caller " +
      "attribution — in **Debug → Slow Events → Aggregates**.",
  );
  lines.push("");
  lines.push(`**Occurrences:** ${row.count}`);
  lines.push(`**Worktree:** ${row.worktree}`);
  lines.push(`**First seen:** ${row.firstSeenAt.toISOString()}`);
  lines.push(`**Last seen:** ${row.lastSeenAt.toISOString()}`);
  return lines.join("\n");
}
