import { join } from "node:path";
import { cliExecContext } from "@plugins/infra/plugins/jobs/plugins/supervised-job/cli";
import { markDaemonRunningGood } from "@plugins/infra/plugins/deps/deps";
import { startDaemonOnDeclared } from "@plugins/infra/plugins/deps/plugins/daemon-binaries/deps";
import { packageCopyDir } from "@plugins/infra/plugins/deps/plugins/package-copy/deps";
import { pgbouncerBinary } from "@plugins/database/plugins/pgbouncer/plugins/binary/deps";

/**
 * Start PgBouncer on the binary main declares (`pgbouncer-binary`, an install
 * in the deps cache — never the checkout's `node_modules`, which a `bun
 * install` rewrites under a running daemon). The gateway runs this script
 * from main's checkout, so a version main lands is what the next fresh start
 * runs; if that start fails, PgBouncer starts on the last binary it started
 * on and a `daemon-binary-rollback` report is filed
 * (`infra/deps/daemon-binaries`).
 *
 * `start` gets the binary's path, and must leave no PgBouncer running when it
 * throws.
 *
 * Imported lazily by `start.ts`: a release's compiled `pgbouncer-start` is
 * handed its vendored binary and never reaches the deps engine.
 */
export async function startOnDeclaredBinary(
  start: (binary: string) => Promise<void>,
): Promise<void> {
  await startDaemonOnDeclared(pgbouncerBinary, {
    exec: cliExecContext(),
    say: (line) => console.log(`pgbouncer: ${line}`),
    start: (ready) =>
      start(join(packageCopyDir(ready), "native", "bin", "pgbouncer")),
  });
}

/** A reattached PgBouncer started fine on what it runs: make that the fallback. */
export async function markReattachedBinaryGood(): Promise<void> {
  await markDaemonRunningGood(pgbouncerBinary);
}
