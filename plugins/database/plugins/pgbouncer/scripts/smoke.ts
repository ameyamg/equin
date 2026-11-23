#!/usr/bin/env bun
/**
 * The `pgbouncer-binary` smoke test (`defineDep({ smoke })`): run by the
 * upgrade runner (`./equin deps upgrade`) before and after the npm updater
 * moves `@equin/pgbouncer`, from the root of the checkout being upgraded. A
 * move lands only if this passes, so a version main declares has already
 * started once before PgBouncer's next start runs it.
 *
 * It installs the checkout's `pgbouncer-binary` (the same copy PgBouncer's
 * start would run), starts it in the foreground on a throwaway config and
 * socket dir (no backend, no TCP), waits for its socket to accept, and stops
 * it. The machine's PgBouncer is never touched.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { ensureDep } from "@plugins/infra/plugins/deps/deps";
import { cliExecContext } from "@plugins/infra/plugins/jobs/plugins/supervised-job/cli";
import { packageCopyDir } from "@plugins/infra/plugins/deps/plugins/package-copy/deps";
import { pgbouncerBinary } from "@plugins/database/plugins/pgbouncer/plugins/binary/deps";
import { PGBOUNCER_PORT } from "../shared";

const READY_TIMEOUT_MS = 30_000;

function socketAccepts(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect(path);
    sock.on("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
  });
}

async function main(): Promise<void> {
  const ready = await ensureDep(pgbouncerBinary, cliExecContext(), {
    log: (line) => console.log(`smoke: ${line}`),
  });
  const binary = join(packageCopyDir(ready), "native", "bin", "pgbouncer");

  // Short: the socket path (<dir>/.s.PGSQL.<port>) must fit a sockaddr_un.
  const dir = mkdtempSync(join(tmpdir(), "pgb-smoke-"));
  const config = join(dir, "pgbouncer.ini");
  writeFileSync(
    config,
    [
      "[databases]",
      "[pgbouncer]",
      "listen_addr =",
      `listen_port = ${PGBOUNCER_PORT}`,
      `unix_socket_dir = ${dir}`,
      "auth_type = any",
      `pidfile = ${join(dir, "pgbouncer.pid")}`,
      "",
    ].join("\n"),
  );
  const socket = join(dir, `.s.PGSQL.${PGBOUNCER_PORT}`);
  const child = spawn(binary, [config], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (b: Buffer) => (output += b.toString()));
  child.stderr.on("data", (b: Buffer) => (output += b.toString()));
  let exit: string | null = null;
  const exited = new Promise<void>((resolve) =>
    child.on("exit", (code, signal) => {
      exit = signal ?? `code ${code}`;
      resolve();
    }),
  );
  try {
    const deadline = performance.now() + READY_TIMEOUT_MS;
    for (;;) {
      if (exit !== null) {
        throw new Error(
          `smoke: pgbouncer exited (${exit}) before its socket accepted:\n${output}`,
        );
      }
      if (await socketAccepts(socket)) break;
      if (performance.now() > deadline) {
        throw new Error(
          `smoke: pgbouncer's socket did not accept within ${READY_TIMEOUT_MS}ms:\n${output}`,
        );
      }
      await Bun.sleep(100);
    }
    console.log(
      `smoke: ${pgbouncerBinary.id} ${ready.identity} started and accepted on a throwaway socket`,
    );
  } finally {
    if (exit === null) {
      child.kill("SIGTERM");
      await exited;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
