import {
  startDaemonDep,
  type Dep,
  type DepSource,
  type Ready,
} from "@plugins/infra/plugins/deps/deps";
import type { ExecContext } from "@plugins/infra/plugins/jobs/plugins/supervised-job/core";
import { fileReportFromProcess } from "@plugins/reports/plugins/outbox/plugins/file/core";
import { daemonRollbackReport } from "../../core";

/** An install as a start script names it: its version, else its identity. */
async function label(ready: Ready<DepSource>): Promise<string> {
  const version = ready.dep.source.version;
  return version === undefined
    ? ready.identity
    : await version.installed(ready.dir);
}

/**
 * A host daemon's start script, on the install main declares (`startDaemonDep`):
 * says which install the daemon runs, and when the start fell back to the
 * previous one, files the `daemon-binary-rollback` report — the one place both
 * daemons' scripts (database/embedded, database/pgbouncer) share. `start` must
 * leave nothing running when it throws: the fallback start comes next.
 */
export async function startDaemonOnDeclared<S extends DepSource>(
  dep: Dep<S>,
  opts: {
    exec: ExecContext;
    /** The script's log, a line at a time (it prefixes its own). */
    say: (line: string) => void;
    start: (ready: Ready<S>) => Promise<void>;
  },
): Promise<void> {
  const { say } = opts;
  const outcome = await startDaemonDep(dep, opts.exec, {
    start: opts.start,
    log: say,
  });
  switch (outcome.kind) {
    case "started":
      say(
        `running ${dep.id} ${await label(outcome.ready)} (${outcome.ready.identity})`,
      );
      return;
    case "kept-previous":
      say(
        `main declares ${dep.id} ${await label(outcome.skipped)}, which failed to start on ${outcome.failure.at} — ` +
          `running ${await label(outcome.ready)}; \`./equin deps remove ${dep.id}\` in main's checkout retries it`,
      );
      return;
    case "rolled-back": {
      const failed =
        outcome.failed === null ? null : await label(outcome.failed);
      const running = await label(outcome.ready);
      say(
        `${dep.id} ${failed ?? "(main's install)"} failed — fell back to ${running}: ${outcome.error}`,
      );
      await fileReportFromProcess(
        daemonRollbackReport({
          dep: dep.id,
          failed,
          running,
          error: outcome.error,
          at: new Date().toISOString(),
        }),
      );
      return;
    }
  }
}
