import { mkdir } from "node:fs/promises";
import { joinAppPath } from "@plugins/infra/plugins/host-fs/plugins/user-path/core";
import { defineFileWatcher } from "@plugins/infra/plugins/file-watcher/server";
import { depsCacheDir } from "@plugins/infra/plugins/deps/data-dirs";
import { runTracked } from "@plugins/infra/plugins/runtime-profiler/core";
import { serveValue } from "@plugins/network/plugins/live/machine";
import { daemonBinaries } from "../../core";
import { currentDaemonBinaries, daemonDepIds } from "./check";
import { onMainMoved } from "./reaction";

/** Open only while someone is subscribed to `deps.daemon-binaries` (the health dot). */
export const daemonDepsWatcher = defineFileWatcher({
  name: "deps.daemon-binaries",
  description:
    "While the health report reads the daemon binaries' row, watches the daemon dependencies' cache dirs, so a daemon's fresh start (its running hold), a failed start's fallback (daemon-failed.json) or a removed install shows at once.",
  // The payloads: only the holds and state files beside them matter.
  ignore: ["**/env/**"],
});

/**
 * The host daemons' binaries against main, pushed. Its inputs change two
 * ways, both observed: main's checkout moves (its bun.lock — the ref
 * reaction) and a daemon's installs change (a fresh start moving its running
 * hold, a fallback marking an install failed — a watcher on just the daemon
 * dependencies' cache dirs, a handful of small files). External: nothing is
 * DB-backed.
 */
export const daemonBinariesServed = serveValue(daemonBinaries, {
  source: "external",
  changes: "notified",
  loader: () => currentDaemonBinaries(),
  whileSubscribed: async (_params, notify) => {
    const root = await depsCacheDir.ensure();
    const dirs = await Promise.all(
      (await daemonDepIds()).map(async (id) => {
        const dir = joinAppPath(root, id);
        // Watched before the first install creates it.
        await mkdir(dir, { recursive: true });
        return dir;
      }),
    );
    const watcher = await daemonDepsWatcher.start({
      dirs,
      onChange: () => notify(),
    });
    const offMain = onMainMoved(() => notify());
    return () => {
      offMain();
      void runTracked("deps-daemon-binaries:watcher-stop", () =>
        watcher.stop(),
      );
    };
  },
});
