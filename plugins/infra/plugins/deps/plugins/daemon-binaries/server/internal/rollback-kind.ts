import { ReportKind } from "@plugins/reports/server";
import type { ReportRow } from "@plugins/reports/server";
import {
  DAEMON_ROLLBACK_KIND,
  DaemonRollbackPayloadSchema,
  describeDaemonRollback,
  type DaemonRollbackPayload,
} from "../../core";

// The `daemon-binary-rollback` kind, filed through the report outbox by a host
// daemon's start script (database/embedded, database/pgbouncer) when its start
// on the install main declares failed and it fell back to the last one that
// started. One standing row per dependency: while it stands, that daemon runs
// an older version than main declares.
export const daemonRollbackKind = ReportKind({
  kind: DAEMON_ROLLBACK_KIND,
  schema: DaemonRollbackPayloadSchema,
  fingerprint: (d: DaemonRollbackPayload) => `${DAEMON_ROLLBACK_KIND}:${d.dep}`,
  meta: {
    tag: `[${DAEMON_ROLLBACK_KIND}]`,
    notif: "A database daemon fell back to its previous binaries",
    variant: "error",
    category: "error",
  },
  renderTask: (row: ReportRow) => {
    const d = DaemonRollbackPayloadSchema.parse(row.data);
    return {
      title: `[${DAEMON_ROLLBACK_KIND}] ${describeDaemonRollback(d)}`,
      description: renderDescription(row, d),
    };
  },
});

function renderDescription(row: ReportRow, d: DaemonRollbackPayload): string {
  return [
    `**${describeDaemonRollback(d)}**`,
    "",
    "A host daemon (the embedded Postgres, PgBouncer) starts on the install main declares, and falls back to " +
      "the last install it started on when that start fails (`infra/deps` `startDaemonDep`). This one fell back: " +
      "the machine runs the previous version, and the failed install is marked so no later start tries it again " +
      "(`daemon-failed.json` beside it). The upgrade that landed it passed the dependency's smoke test, so look " +
      "for what differs on this machine (its data, its environment, the live config).",
    "",
    `**Dependency:** \`${d.dep}\``,
    `**Failed:** ${d.failed === null ? "main's install could not be made" : `\`${d.failed}\``}`,
    `**Running:** \`${d.running}\``,
    `**At:** ${d.at}`,
    "",
    "**Error:**",
    "",
    "```",
    d.error,
    "```",
    "",
    `**What to do:** fix the cause, then \`./equin deps remove ${d.dep}\` in main's checkout (it removes the failed ` +
      "install, so the daemon's next fresh start tries it again), and restart the daemon. Or hold the release in " +
      "the declaring package.json's `dependencyPolicy.holds` (a reason and a review day) and push, so main " +
      "declares the version that runs.",
    "",
    `**Occurrences:** ${row.count}`,
    `**First seen:** ${row.firstSeenAt.toISOString()}`,
    `**Last seen:** ${row.lastSeenAt.toISOString()}`,
  ].join("\n");
}
