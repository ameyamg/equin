#!/usr/bin/env bun
/**
 * The `postgres-binaries` smoke test (`defineDep({ smoke })`): run by the
 * upgrade runner (`./equin deps upgrade`) before and after the npm updater
 * moves `@embedded-postgres`, from the root of the checkout being upgraded.
 * A move lands only if this passes, so a version main declares has already
 * started once before the cluster's next start runs it.
 *
 * It installs the checkout's `postgres-binaries` (the same copy the cluster's
 * start would run), refuses a server of another major than the cluster's
 * (`PG_MAJOR`: its data must be migrated first, and no procedure exists yet —
 * hold the package below the next major instead), then initdb's a throwaway
 * cluster in a temp dir, starts it on its own socket (no TCP), and stops it.
 * The machine's cluster is never touched.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
} from "@plugins/packages/plugins/timed-fs/core";
import { ensureDep } from "@plugins/infra/plugins/deps/deps";
import { cliExecContext } from "@plugins/infra/plugins/jobs/plugins/supervised-job/cli";
import { packageCopyDir } from "@plugins/infra/plugins/deps/plugins/package-copy/deps";
import { postgresBinaries } from "@plugins/database/plugins/embedded/plugins/binaries/deps";
import { PG_MAJOR, PG_PORT, PG_USER } from "../shared";
import { ensureSymlinks, serverMajor } from "./server-binaries";

const READY_TIMEOUT_SEC = 30;

function run(binDir: string, tool: string, args: string[]): void {
  const result = spawnSync(join(binDir, tool), args, { stdio: "pipe" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime guard; SpawnSyncReturns fields may be null
    const out = result.stderr?.toString() || result.stdout?.toString() || "";
    throw new Error(
      `smoke: ${tool} ${args[0]} failed (exit ${result.status}): ${out}`,
    );
  }
}

async function main(): Promise<void> {
  const ready = await ensureDep(postgresBinaries, cliExecContext(), {
    log: (line) => console.log(`smoke: ${line}`),
  });
  const binDir = join(packageCopyDir(ready), "native", "bin");
  ensureSymlinks(binDir);
  const major = serverMajor(binDir);
  if (major !== PG_MAJOR) {
    throw new Error(
      `smoke: ${postgresBinaries.id} is PostgreSQL ${major}, but the cluster is PostgreSQL ${PG_MAJOR}: ` +
        `a major upgrade needs the cluster's data migrated (pg_upgrade), and no procedure exists yet. ` +
        `Hold the @embedded-postgres packages below ${PG_MAJOR + 1}.0.0 in plugins/database/plugins/embedded/package.json's ` +
        `dependencyPolicy.holds (a reason and a review day), so the upgrade leaves them on ${PG_MAJOR}.`,
    );
  }

  // Short: the socket path (<dir>/.s.PGSQL.<port>) must fit a sockaddr_un.
  const dir = mkdtempSync(join(tmpdir(), "pg-smoke-"));
  const data = join(dir, "data");
  const log = join(dir, "postgres.log");
  try {
    run(binDir, "initdb", [
      "-D",
      data,
      "-U",
      PG_USER,
      "-A",
      "trust",
      "--no-locale",
      "--encoding",
      "UTF8",
    ]);
    try {
      run(binDir, "pg_ctl", [
        "start",
        "-D",
        data,
        "-l",
        log,
        "-o",
        `-k ${dir} -p ${PG_PORT} -c listen_addresses=''`,
        "-w",
        "-t",
        String(READY_TIMEOUT_SEC),
      ]);
    } catch (err) {
      const tail = existsSync(log)
        ? readFileSync(log, "utf-8").split("\n").slice(-20).join("\n")
        : "(no log)";
      throw new Error(
        `${(err as Error).message}\n--- postgres.log ---\n${tail}`,
      );
    } finally {
      // Stopped whatever the start's outcome: one that timed out may be up.
      if (existsSync(join(data, "postmaster.pid"))) {
        run(binDir, "pg_ctl", ["stop", "-D", data, "-m", "immediate", "-w"]);
      }
    }
    console.log(
      `smoke: ${postgresBinaries.id} ${ready.identity} (PostgreSQL ${major}) initdb'd, started and stopped a throwaway cluster`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
