import { join } from "node:path";
import { cliExecContext } from "@plugins/infra/plugins/jobs/plugins/supervised-job/cli";
import { markDaemonRunningGood } from "@plugins/infra/plugins/deps/deps";
import { startDaemonOnDeclared } from "@plugins/infra/plugins/deps/plugins/daemon-binaries/deps";
import { packageCopyDir } from "@plugins/infra/plugins/deps/plugins/package-copy/deps";
import { postgresBinaries } from "@plugins/database/plugins/embedded/plugins/binaries/deps";

/**
 * Start the cluster on the server binaries main declares (`postgres-binaries`,
 * an install in the deps cache — never the checkout's `node_modules`, which a
 * `bun install` rewrites under a running postmaster). The gateway runs this
 * script from main's checkout, so a version main lands is what the next fresh
 * start runs; if that start fails, the cluster starts on the last binaries it
 * started on and a `daemon-binary-rollback` report is filed
 * (`infra/deps/daemon-binaries`).
 *
 * `start` gets the binaries' `bin` dir, and must leave no postmaster running
 * when it throws.
 *
 * Imported lazily by `start.ts`: a release's compiled `pg-start` is handed
 * its vendored binaries and never reaches the deps engine.
 */
export async function startOnDeclaredBinaries(
  start: (binDir: string) => Promise<void>,
): Promise<void> {
  await startDaemonOnDeclared(postgresBinaries, {
    exec: cliExecContext(),
    say: (line) => console.log(`pg: ${line}`),
    start: (ready) => start(join(packageCopyDir(ready), "native", "bin")),
  });
}

/** A reattached postmaster started fine on what it runs: make that the fallback. */
export async function markReattachedBinariesGood(): Promise<void> {
  await markDaemonRunningGood(postgresBinaries);
}
