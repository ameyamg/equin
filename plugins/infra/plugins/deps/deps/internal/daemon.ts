import { mkdir, rename, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { AppPath } from "@plugins/infra/plugins/host-fs/plugins/user-path/core";
import type { ExecContext } from "@plugins/infra/plugins/jobs/plugins/supervised-job/core";
import { REPO_ROOT } from "@plugins/infra/plugins/paths/plugins/repo-root/core";
import { exists, readFile } from "@plugins/packages/plugins/timed-fs/core";
import { dirname } from "node:path";
import type { Dep, DepDaemon, DepSource, Ready } from "./dep";
import { ensureDep } from "./ensure";
import { heldDep, holdDep } from "./hold";
import {
  currentIdentity,
  defaultStore,
  installPaths,
  type DepStore,
} from "./store";

/**
 * Why a host daemon did not run an install: a start on it failed and the
 * daemon fell back to the last install that started. Written beside the
 * install (`daemon-failed.json`), so it goes with it — removing the install
 * (`./equin deps remove <id>`, Debug → Dependencies) is the retry.
 */
const DaemonFailedSchema = z.object({
  at: z.string(),
  error: z.string(),
});
export type DaemonFailed = z.infer<typeof DaemonFailedSchema>;

/** Starts the daemon on `ready`. Throws when it does not come up, leaving nothing running. */
export type DaemonStart<S extends DepSource> = (
  ready: Ready<S>,
) => Promise<void>;

/** What {@link startDaemonDep} ran. */
export type DaemonStartOutcome<S extends DepSource> =
  /** The install main declares, now marked the last that started. */
  | { kind: "started"; ready: Ready<S> }
  /**
   * The declared install failed to start (or could not be installed): the
   * daemon runs the last install that started. `failed` is null when the
   * declared install could not even be made.
   */
  | {
      kind: "rolled-back";
      ready: Ready<S>;
      failed: Ready<S> | null;
      error: string;
    }
  /**
   * The declared install failed on an earlier start (`failure`): not tried
   * again, the daemon runs the last install that started.
   */
  | {
      kind: "kept-previous";
      ready: Ready<S>;
      skipped: Ready<S>;
      failure: DaemonFailed;
    };

interface DaemonOptions<S extends DepSource> {
  start: DaemonStart<S>;
  /** The checkout whose declaration to run. Default: this one (main's, for the gateway's start scripts). */
  root?: AppPath;
  store?: DepStore;
  log?: (line: string) => void;
}

function daemonOf(dep: Dep<DepSource>): DepDaemon {
  if (dep.daemon === null) {
    throw new Error(
      `${dep.id} declares no daemon: it is run by the checkout's own code (ensureDep), not by a host daemon`,
    );
  }
  return dep.daemon;
}

/** The hold naming the install the live daemon was started from. */
function runningHolder(daemon: DepDaemon): string {
  return `${daemon.holder}-running`;
}

/**
 * Start a host daemon on the install the checkout declares (main's: the
 * gateway runs the start scripts from main's checkout), falling back to the
 * last install a start succeeded on:
 *
 * 1. The declared install is ensured. It is held `<holder>-running` before
 *    `start`, so the sweep never takes bytes a daemon runs.
 * 2. `start` succeeds → it is held `<holder>` (the last that started).
 * 3. It throws (or the install cannot be made) and the last install that
 *    started is another → that one is started instead, once, and the
 *    declared one is marked failed (`daemon-failed.json`) so no later start
 *    tries it again. The caller reports the rollback. Both failing throws both.
 * 4. A declared install already marked failed is not tried: the last that
 *    started runs (`kept-previous`).
 * 5. Nothing to fall back to → the failure is thrown.
 */
export async function startDaemonDep<S extends DepSource>(
  dep: Dep<S>,
  exec: ExecContext,
  opts: DaemonOptions<S>,
): Promise<DaemonStartOutcome<S>> {
  const daemon = daemonOf(dep);
  const store = opts.store ?? (await defaultStore());
  const good = await heldDep(dep, daemon.holder, { store });
  const fallback = good.kind === "held" ? good.ready : null;

  let declared: Ready<S>;
  try {
    declared = await ensureDep(dep, exec, {
      root: opts.root ?? REPO_ROOT,
      store,
      log: opts.log,
    });
  } catch (err) {
    if (fallback === null) throw err;
    await run(fallback, opts.start, daemon, store);
    return {
      kind: "rolled-back",
      ready: fallback,
      failed: null,
      error: messageOf(err),
    };
  }

  const usable = fallback !== null && fallback.identity !== declared.identity;
  if (usable) {
    const failure = await readDaemonFailed(dep, declared.identity, store);
    if (failure !== null) {
      await run(fallback, opts.start, daemon, store);
      return {
        kind: "kept-previous",
        ready: fallback,
        skipped: declared,
        failure,
      };
    }
  }

  try {
    await run(declared, opts.start, daemon, store);
    return { kind: "started", ready: declared };
  } catch (err) {
    if (!usable) throw err;
    const error = messageOf(err);
    await writeDaemonFailed(dep, declared.identity, store, {
      at: new Date().toISOString(),
      error,
    });
    try {
      await run(fallback, opts.start, daemon, store);
    } catch (again) {
      throw new Error(
        `${dep.id}: ${declared.identity} failed to start (${error}), and so did the previous ${fallback.identity} (${messageOf(again)})`,
      );
    }
    return { kind: "rolled-back", ready: fallback, failed: declared, error };
  }
}

async function run<S extends DepSource>(
  ready: Ready<S>,
  start: DaemonStart<S>,
  daemon: DepDaemon,
  store: DepStore,
): Promise<void> {
  await holdDep(ready, runningHolder(daemon), { store });
  await start(ready);
  await holdDep(ready, daemon.holder, { store });
}

/**
 * A daemon that was already running when its start script ran (a reattach)
 * started fine on what it runs: mark that install the last that started, so a
 * machine whose daemon predates `startDaemonDep` has a rollback target.
 */
export async function markDaemonRunningGood(
  dep: Dep<DepSource>,
  opts: { store?: DepStore } = {},
): Promise<void> {
  const daemon = daemonOf(dep);
  const running = await heldDep(dep, runningHolder(daemon), opts);
  if (running.kind === "held")
    await holdDep(running.ready, daemon.holder, opts);
}

async function readDaemonFailed(
  dep: Dep<DepSource>,
  identity: string,
  store: DepStore,
): Promise<DaemonFailed | null> {
  const file = installPaths(store, dep.id, identity).daemonFailed;
  if (!(await exists(file))) return null;
  return DaemonFailedSchema.parse(JSON.parse(await readFile(file, "utf8")));
}

async function writeDaemonFailed(
  dep: Dep<DepSource>,
  identity: string,
  store: DepStore,
  failed: DaemonFailed,
): Promise<void> {
  const file = installPaths(store, dep.id, identity).daemonFailed;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify(failed));
  await rename(`${file}.tmp`, file);
}

/** One install of a daemon dependency, as {@link daemonStatus} names it. */
export interface DaemonInstall {
  readonly identity: string;
  /** Its version (`DepSource.version`), or null when the source reads none. */
  readonly version: string | null;
}

/**
 * Where a daemon dependency stands, read only (nothing installed or held):
 * the install the live daemon was started from (null before any start), and
 * what the checkout at `root` declares — the same, another (taking effect at
 * the next fresh start, or `failed` when a start already fell back from it),
 * or underivable.
 */
export interface DaemonStatus {
  readonly running: DaemonInstall | null;
  readonly declared:
    | { kind: "same" }
    | { kind: "differs"; install: DaemonInstall; failed: DaemonFailed | null }
    | { kind: "unreadable"; message: string };
}

export async function daemonStatus(
  dep: Dep<DepSource>,
  opts: { root: AppPath; store?: DepStore },
): Promise<DaemonStatus> {
  const daemon = daemonOf(dep);
  const store = opts.store ?? (await defaultStore());
  const version = dep.source.version;
  const held = await heldDep(dep, runningHolder(daemon), { store });
  const running: DaemonInstall | null =
    held.kind === "held"
      ? {
          identity: held.ready.identity,
          version: (await version?.installed(held.ready.dir)) ?? null,
        }
      : null;
  let install: DaemonInstall;
  try {
    const [{ identity }, declaredVersion] = await Promise.all([
      currentIdentity(dep, opts.root),
      version?.declared(opts.root) ?? null,
    ]);
    install = { identity, version: declaredVersion };
  } catch (err) {
    return {
      running,
      declared: { kind: "unreadable", message: messageOf(err) },
    };
  }
  if (running?.identity === install.identity) {
    return { running, declared: { kind: "same" } };
  }
  return {
    running,
    declared: {
      kind: "differs",
      install,
      failed: await readDaemonFailed(dep, install.identity, store),
    },
  };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
