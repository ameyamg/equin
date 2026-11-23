import { z } from "zod";
import { liveValue } from "@plugins/network/plugins/live/core";
import { wholeList } from "@plugins/packages/plugins/list-bound/core";

/** One install of a daemon dependency: its identity, and its version when its source reads one. */
const InstallSchema = z.object({
  identity: z.string(),
  version: z.string().nullable(),
});
export type DaemonInstallView = z.infer<typeof InstallSchema>;

/**
 * Where one host daemon's binaries stand against main's checkout — the
 * infra/deps engine's `DaemonStatus`, as data: the install the live daemon
 * was started from (null before any start), and what main declares — the
 * same, another (taking effect at `appliesAt`; `failed` when a start already
 * fell back from it), or unreadable.
 */
export const DaemonDepRowSchema = z.object({
  id: z.string(),
  description: z.string(),
  /** When a new install takes effect ("the cluster's next full restart"). */
  appliesAt: z.string(),
  running: InstallSchema.nullable(),
  declared: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("same") }),
    z.object({
      kind: z.literal("differs"),
      install: InstallSchema,
      failed: z.object({ at: z.string(), error: z.string() }).nullable(),
    }),
    z.object({ kind: z.literal("unreadable"), message: z.string() }),
  ]),
});
export type DaemonDepRow = z.infer<typeof DaemonDepRowSchema>;

/**
 * Every daemon dependency against main's checkout (`mainRoot`, where the
 * gateway runs the daemons' start scripts); not applicable on a release (its
 * bundle sealed the binaries) or a checkout declaring none; unreadable when
 * the check itself failed.
 */
export const DaemonBinariesSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("checked"),
    mainRoot: z.string(),
    rows: wholeList(DaemonDepRowSchema, {
      reason:
        "one row per dependency a host daemon runs — the database daemons' binaries, a closed handful",
    }),
  }),
  z.object({ kind: z.literal("not-applicable"), reason: z.string() }),
  z.object({ kind: z.literal("unreadable"), message: z.string() }),
]);
export type DaemonBinaries = z.infer<typeof DaemonBinariesSchema>;

/**
 * The host daemons' binaries against main, pushed whenever the answer
 * changes. It reads the computer's deps cache and main's checkout
 * (`needsMachine`): a reader under an in-browser server gets `unavailable`.
 */
export const daemonBinaries = liveValue("deps.daemon-binaries", {
  schema: DaemonBinariesSchema,
  needsMachine: { feature: "Checking the database daemons' binaries" },
});

/**
 * The command that removes a failed install, run in main's checkout: the next
 * fresh start of the daemon installs it again and tries it once more.
 */
export function retryCommand(mainRoot: string, id: string): string {
  return `cd ${mainRoot} && ./equin deps remove ${id}`;
}

/** An install as people read it: its version, else its identity. */
export function installLabel(install: DaemonInstallView): string {
  return install.version ?? install.identity;
}

/**
 * The `daemon-binary-rollback` report: a host daemon's start failed on the
 * install main declares and fell back to the last one that started. Filed by
 * the daemon's start script through the report outbox.
 */
export const DaemonRollbackPayloadSchema = z.object({
  /** The dependency (`postgres-binaries`). */
  dep: z.string(),
  /** The install that failed (its version, else identity); null when it could not even be installed. */
  failed: z.string().nullable(),
  /** The install the daemon runs instead. */
  running: z.string(),
  error: z.string(),
  at: z.string(),
});
export type DaemonRollbackPayload = z.infer<typeof DaemonRollbackPayloadSchema>;

export const DAEMON_ROLLBACK_KIND = "daemon-binary-rollback";

/** One line: what failed and what runs instead. */
export function describeDaemonRollback(d: DaemonRollbackPayload): string {
  return d.failed === null
    ? `${d.dep}: main's install could not be made — still running ${d.running}`
    : `${d.dep} ${d.failed} failed to start — running ${d.running}`;
}

/**
 * The report a start script files (through the report outbox,
 * `fileReportFromProcess`) when its daemon fell back to its previous binaries.
 */
export function daemonRollbackReport(d: DaemonRollbackPayload): {
  kind: string;
  message: string;
  data: DaemonRollbackPayload;
} {
  return {
    kind: DAEMON_ROLLBACK_KIND,
    message: describeDaemonRollback(d),
    data: DaemonRollbackPayloadSchema.parse(d),
  };
}
