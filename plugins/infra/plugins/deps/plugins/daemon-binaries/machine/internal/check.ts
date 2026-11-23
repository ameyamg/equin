import {
  daemonStatus,
  declaredDeps,
  type Dep,
  type DepSource,
} from "@plugins/infra/plugins/deps/deps";
import { isRelease } from "@plugins/infra/plugins/paths/core";
import { getMainRepoRoot } from "@plugins/infra/plugins/spawn/core";
import type { DaemonBinaries, DaemonDepRow } from "../../core";

/** The dependencies a host daemon runs: none on a release (its bundle sealed the binaries). */
async function daemonDeps(): Promise<Dep<DepSource>[]> {
  if (isRelease()) return [];
  return (await declaredDeps()).filter((dep) => dep.daemon !== null);
}

/**
 * Every daemon dependency against main's checkout — the git store's own
 * checkout (`getMainRepoRoot`), where the gateway runs the daemons' start
 * scripts from and so whose declaration they start on; never a worktree's,
 * nor main's served slot. Read only: nothing installs or moves.
 */
export async function checkDaemonBinaries(): Promise<DaemonBinaries> {
  if (isRelease()) {
    return {
      kind: "not-applicable",
      reason: "A release runs the binaries its bundle sealed",
    };
  }
  const deps = await daemonDeps();
  if (deps.length === 0) {
    return {
      kind: "not-applicable",
      reason: "No dependency of this checkout is run by a host daemon",
    };
  }
  const mainRoot = await getMainRepoRoot();
  const rows = await Promise.all(
    deps.map(async (dep): Promise<DaemonDepRow> => {
      const status = await daemonStatus(dep, { root: mainRoot });
      return {
        id: dep.id,
        description: dep.description,
        appliesAt: dep.daemon?.appliesAt ?? "",
        running: status.running,
        declared: status.declared,
      };
    }),
  );
  return { kind: "checked", mainRoot, rows };
}

/** {@link checkDaemonBinaries}, a failure answered as `unreadable` rather than thrown at every tab. */
export async function currentDaemonBinaries(): Promise<DaemonBinaries> {
  try {
    return await checkDaemonBinaries();
  } catch (err) {
    return {
      kind: "unreadable",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** The ids of the daemon dependencies, whose cache dirs the push watches. */
export async function daemonDepIds(): Promise<string[]> {
  return (await daemonDeps()).map((dep) => dep.id);
}
