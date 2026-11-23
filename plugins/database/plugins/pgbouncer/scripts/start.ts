#!/usr/bin/env bun
import {
  envName,
  readEnv,
} from "@plugins/infra/plugins/launcher/plugins/env-names/core";
import {
  serviceLogTarget,
  type ServiceLogTarget,
} from "@plugins/infra/plugins/launcher/plugins/gateway-logs/core";
import { adoptLegacyLogSync } from "@plugins/infra/plugins/launcher/plugins/gateway-logs/data-dirs";
import { adoptFd, type OwnedFd } from "@plugins/packages/plugins/owned-fd/core";
import { writeFileSync, rmSync } from "node:fs";
import {
  existsSync,
  readFileSync,
  statSync,
} from "@plugins/packages/plugins/timed-fs/core";
import {
  judgePidFile,
  psProbeArgv,
  readPsProbe,
  type PidFileHolder,
  type PidFileRead,
} from "@plugins/packages/plugins/pid-file-holder/core";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { connect } from "node:net";
import {
  PGBOUNCER_PORT,
  PGBOUNCER_SOCKET_DIR,
  PGBOUNCER_CONFIG_FILE,
  PGBOUNCER_USERLIST_FILE,
  PGBOUNCER_LOG_FILE,
  PGBOUNCER_LEGACY_LOG_FILE,
  PGBOUNCER_PID_FILE,
} from "../shared";
import { pgbouncerConfigFiles } from "../server";

const READY_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 10_000;
const PGBOUNCER_SOCKET = join(
  PGBOUNCER_SOCKET_DIR,
  `.s.PGSQL.${PGBOUNCER_PORT}`,
);

// ─── binary resolution ──────────────────────────────────────

/**
 * Run `start` on the binary this start uses — never the checkout's
 * `node_modules`, which a `bun install` rewrites under a running daemon (and
 * whose next start would then silently run a new version).
 *
 * - A packaged release names its vendored binary (`PGBOUNCER_BIN`).
 * - Otherwise the install main declares (`pgbouncer-binary`, see
 *   `daemon-binary.ts`), falling back to the last one a start succeeded on.
 */
async function runOnBinary(
  start: (binary: string) => Promise<void>,
): Promise<void> {
  const override = readEnv("PGBOUNCER_BIN");
  if (override) {
    if (!existsSync(override)) {
      throw new Error(
        `pgbouncer: ${envName("PGBOUNCER_BIN")} set to ${override} but that file does not exist`,
      );
    }
    await start(override);
    return;
  }
  const { startOnDeclaredBinary } = await import("./daemon-binary");
  await startOnDeclaredBinary(start);
}

/** A reattach: the binary the live daemon runs becomes the fallback (none on a release). */
async function markReattachedGood(): Promise<void> {
  if (readEnv("PGBOUNCER_BIN")) return;
  const { markReattachedBinaryGood } = await import("./daemon-binary");
  await markReattachedBinaryGood();
}

// ─── socket probe ───────────────────────────────────────────

function pingSocket(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect(PGBOUNCER_SOCKET);
    const timer = setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, timeoutMs);
    sock.on("connect", () => {
      clearTimeout(timer);
      sock.destroy();
      resolve(true);
    });
    sock.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

// ─── launch ─────────────────────────────────────────────────

/**
 * Where a launched PgBouncer's output goes, adopted ONCE per run of this
 * script, so a fallback launch (after a failed start) writes to the same relay.
 *
 * `absent` is a gateway older than the relay running this script (its binary is
 * only rebuilt by `./equin start`): PgBouncer daemonizes as before, with no log
 * at all — said out loud, never by quietly reviving the unbounded file.
 */
type LaunchOutput = { kind: "relay"; relay: OwnedFd } | { kind: "absent" };

function launchOutput(target: ServiceLogTarget): LaunchOutput {
  if (target.kind !== "relay") {
    console.log(
      "pgbouncer: this gateway predates the service log relay; running without a log — restart the gateway (./equin start --force) and then pgbouncer",
    );
    return { kind: "absent" };
  }
  const adopted = adoptLegacyLogSync(
    PGBOUNCER_LEGACY_LOG_FILE,
    PGBOUNCER_LOG_FILE,
  );
  if (adopted.kind === "moved")
    console.log(
      `pgbouncer: moved ${PGBOUNCER_LEGACY_LOG_FILE} to ${adopted.to}`,
    );
  if (adopted.kind === "slots-full")
    console.log(
      `pgbouncer: left ${PGBOUNCER_LEGACY_LOG_FILE} in place: every backup slot of ${PGBOUNCER_LOG_FILE} is taken`,
    );
  // The relay fd is this script's to close once PgBouncer holds its copies.
  return { kind: "relay", relay: adoptFd(target.fd) };
}

/**
 * Start the daemon. With the gateway's log relay, PgBouncer runs in the
 * FOREGROUND (it logs to stderr only when not daemonized), detached into its
 * own session with stdout/stderr on the relay fd, and this script lets go of it
 * — so its log is the relay's bounded channel, and the config names no
 * `logfile`. It still writes its pidfile, which every stop and reattach reads.
 */
function launch(binary: string, output: LaunchOutput): Launched {
  if (output.kind === "relay") {
    const child = spawn(binary, [PGBOUNCER_CONFIG_FILE], {
      detached: true,
      stdio: ["ignore", output.relay.fd, output.relay.fd],
    });
    // A foreground daemon that dies at once (a config it refuses) says why on
    // the relay, not here: the readiness wait stops at its exit, naming the log.
    const launched: Launched = { exit: null };
    child.on("exit", (code, signal) => {
      launched.exit = signal ?? `code ${code}`;
    });
    child.unref();
    return launched;
  }
  const result = spawnSync(binary, [PGBOUNCER_CONFIG_FILE, "-d"], {
    stdio: "pipe",
  });
  if (result.status !== 0) {
    const out = result.stderr?.toString() || result.stdout?.toString() || "";
    throw new Error(`pgbouncer start failed: ${out}`);
  }
  // Daemonized: the -d parent's own exit is the success above.
  return { exit: null };
}

/**
 * After a failed start: stop a PgBouncer it left running (alive, its socket
 * never answering), so a fallback launch on another binary finds none. One
 * that will not stop fails loudly, naming it.
 */
async function stopLeftoverPgbouncer(): Promise<void> {
  const holder = pgbouncerHolder(readPidFile());
  if (holder.kind !== "live") return;
  console.log(
    `pgbouncer: stopping the daemon (pid ${holder.pid}) the failed start left running`,
  );
  process.kill(holder.pid, "SIGTERM");
  const deadline = performance.now() + STOP_TIMEOUT_MS;
  while (performance.now() < deadline) {
    if (pgbouncerHolder(readPidFile()).kind !== "live") return;
    await Bun.sleep(100);
  }
  throw new Error(
    `pgbouncer: a failed start left a daemon (pid ${holder.pid}) that did not stop within ${STOP_TIMEOUT_MS}ms — not starting another`,
  );
}

/** How the launched process ended, while the readiness wait runs; null while it lives. */
interface Launched {
  exit: string | null;
}

// ─── who holds the pidfile ──────────────────────────────────

/**
 * Who holds PgBouncer's pidfile, judged by the pid it names
 * (`packages/pid-file-holder`) — never by dialing the socket, which fails for
 * a PgBouncer that is only slow: reading that as "crashed" deleted a live
 * daemon's pidfile (so no stop or teardown could find it again) and started a
 * second one beside it. The daemon this script launches runs as this user
 * with its config file on its command line, so that process is PgBouncer.
 */
function pgbouncerHolder(file: PidFileRead | null): PidFileHolder {
  return judgePidFile(file, {
    uid: process.getuid!(),
    executable: "pgbouncer",
    argvMarker: PGBOUNCER_CONFIG_FILE,
    probe: (pid) => {
      const [cmd, ...args] = psProbeArgv(pid);
      const ps = spawnSync(cmd!, args, { encoding: "utf8" });
      if (ps.error) throw ps.error;
      return readPsProbe(pid, ps, Date.now());
    },
  });
}

/** The pidfile's text and mtime (stat after the read, so the mtime is never older than the text), or null when there is none. */
function readPidFile(): PidFileRead | null {
  try {
    const text = readFileSync(PGBOUNCER_PID_FILE, "utf-8");
    return { text, mtimeMs: statSync(PGBOUNCER_PID_FILE).mtimeMs };
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

/** Wait for the socket to accept, failing if `exited` reports the daemon gone first. */
async function waitReady(exited: () => string | null): Promise<void> {
  const deadline = performance.now() + READY_TIMEOUT_MS;
  while (performance.now() < deadline) {
    const exit = exited();
    if (exit !== null) {
      throw new Error(
        `pgbouncer exited (${exit}) before it was ready (see ${PGBOUNCER_LOG_FILE})`,
      );
    }
    if (await pingSocket(500)) return;
    await Bun.sleep(300);
  }
  throw new Error(
    `pgbouncer: did not become ready within ${READY_TIMEOUT_MS}ms (see ${PGBOUNCER_LOG_FILE})`,
  );
}

// ─── main lifecycle ─────────────────────────────────────────

async function main(): Promise<void> {
  const judged = readPidFile();
  const holder = pgbouncerHolder(judged);
  switch (holder.kind) {
    case "live":
      // Reattach. It keeps the config of its own start; the first backend to
      // boot converges it onto the current one (`database/pgbouncer#machine`'s
      // convergePgbouncerConfig). Alive is not answering: a socket that never
      // accepts fails the start, naming it — the daemon is left running.
      console.log(
        `pgbouncer: already running (pid ${holder.pid}); reattaching`,
      );
      await waitReady(() => null);
      await markReattachedGood();
      return;
    case "absent":
      break;
    case "stale":
      // Only while the file still says what was judged, so a PgBouncer that
      // wrote it since is never the one unlinked.
      const now = readPidFile();
      if (now?.text !== judged!.text || now.mtimeMs !== judged!.mtimeMs) {
        throw new Error(
          `pgbouncer: ${PGBOUNCER_PID_FILE} changed while it was judged stale (${holder.why}); not removing it — re-run the start`,
        );
      }
      console.log(`pgbouncer: removing stale pidfile (${holder.why})`);
      rmSync(PGBOUNCER_PID_FILE, { force: true });
      break;
    case "foreign":
      throw new Error(
        `pgbouncer: ${PGBOUNCER_PID_FILE} names pid ${holder.pid}, a process of yours that is not PgBouncer (${holder.args}); not removing it. If no pgbouncer runs with ${PGBOUNCER_CONFIG_FILE}, remove the file and re-run the start`,
      );
    case "unreadable":
      throw new Error(
        `pgbouncer: ${PGBOUNCER_PID_FILE} names no pid (${JSON.stringify(holder.text.slice(0, 80))}); not removing it. If no pgbouncer runs with ${PGBOUNCER_CONFIG_FILE}, remove the file and re-run the start`,
      );
  }

  // Generate config fresh each boot (idempotent), from the lane table — the
  // same rendering every backend converges the running daemon onto.
  const { ini, userlist } = pgbouncerConfigFiles();
  writeFileSync(PGBOUNCER_USERLIST_FILE, userlist);
  writeFileSync(PGBOUNCER_CONFIG_FILE, ini);

  // Only a fresh start resolves the binary: a reattach runs nothing, so it
  // never depends on what main declares to keep a running daemon. Main's
  // binary is tried first; a start that fails on it runs again on the last
  // binary that started.
  const output = launchOutput(serviceLogTarget(process.argv));
  try {
    await runOnBinary(async (binary) => {
      console.log(
        `pgbouncer: starting (socket=${PGBOUNCER_SOCKET_DIR}, port=${PGBOUNCER_PORT})`,
      );
      const launched = launch(binary, output);
      try {
        await waitReady(() => launched.exit);
      } catch (err) {
        await stopLeftoverPgbouncer();
        throw err;
      }
    });
  } finally {
    if (output.kind === "relay") output.relay.close();
  }
  console.log("pgbouncer: ready");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
