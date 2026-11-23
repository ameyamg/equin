// First, before any module that could make a slot: see track-slot-sites.ts.
import "./track-slot-sites";
import { beforeEach } from "bun:test";
import { discardHeldReports } from "@plugins/primitives/plugins/report-sink/core/testing";
import { declareRuntimeNamespace } from "@plugins/infra/plugins/runtime-identity/core";
import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  PLUGINS_DIR,
  checkoutNamespace,
} from "@plugins/infra/plugins/paths/core";
import { declareDataRootLayoutSync } from "@plugins/infra/plugins/paths/plugins/data-root-layout/core";
import { REPO_ROOT } from "@plugins/infra/plugins/paths/plugins/repo-root/core";
import type { ServerContribution } from "@plugins/framework/plugins/server-core/core";
import {
  readEnv,
  unsetEnv,
} from "@plugins/infra/plugins/launcher/plugins/env-names/core";
import { readAwakeClock } from "@plugins/packages/plugins/sleep-clock/core";
import {
  LOOP_HEARTBEAT_EVERY_MS,
  formatLoopHeartbeat,
} from "@plugins/framework/plugins/cli/plugins/test/core";

// The loop heartbeat `./equin test` asked for (cli/test core loop-heartbeat.ts):
// the awake clock, stamped while this process's event loop turns, so the runner
// can tell a test stuck in native code — which bun's own per-test timeout,
// enforced on this same loop, can never time out — from a slow one. Armed
// before anything else the preload does (until the first stamp the runner
// counts from the spawn), and unref'd: it never holds the process
// open. Only under the runner (a hand-run `bun test` has nobody reading it).
const heartbeatPath = readEnv("TEST_HEARTBEAT");
// This process's own: a `bun test` a suite spawns must not stamp the same file
// (it would keep a wedged parent looking alive).
unsetEnv("TEST_HEARTBEAT");
if (heartbeatPath !== undefined) {
  const beat = (): void => {
    const clock = readAwakeClock();
    if (!clock.supported) return;
    // Beside, then renamed over: the runner never reads a half-written stamp.
    const staged = `${heartbeatPath}.${process.pid}.tmp`;
    writeFileSync(staged, formatLoopHeartbeat(clock.awakeMs));
    renameSync(staged, heartbeatPath);
  };
  beat();
  setInterval(beat, LOOP_HEARTBEAT_EVERY_MS).unref();
}

// `bun test` preload (registered in the root bunfig.toml `[test]` section).
//
// Worktree-scoped server code — the `db` pool, the per-worktree log dir,
// config_v2, reports — asks `runtimeNamespace()` which namespace this process
// serves. A real backend is told by the gateway (`--namespace <ns>`); a bare
// `bun test` is told by nobody, so any suite that transitively touches that code
// would throw the moment it ran.
//
// The default belongs HERE, not at each read site: those must stay loud in
// production (a backend with no identity is a real bug), but a test run's
// sensible identity is simply the checkout it runs from.
//
// `checkoutNamespace` MINTS the namespace — it asks git which root owns `.git`
// and applies the elision rule — rather than casting the checkout's directory
// basename. The two agree for every agent worktree and for main, which is
// exactly why the shortcut is tempting and exactly why it is banned
// (`namespace-identity/no-laundered-checkout-namespace`): they stop agreeing the
// moment a composition is served from a non-main checkout.
//
// That mint is async, hence the top-level await. A preload is an ES module, so
// the whole preload is awaited before the first test file is imported — which
// is the property that matters: no suite can observe an undeclared namespace.
// The root of a `bun test` process tree: decide the data root before any suite
// reads a path (infra/paths CLAUDE.md, § The data root). A suite that repoints
// the root sets EQUIN_DIR, which wins over the declaration.
declareDataRootLayoutSync();
declareRuntimeNamespace(await checkoutNamespace(REPO_ROOT));

// A test process is also a HOST that never boots its plugin graph: suites call
// code that reads host services (`db` reads the database driver, `job.enqueue`
// the job queue) with no `collectContributions` behind them. A `bun test` runs
// on the desktop, so its providers are the desktop's — the machine half that
// provides each service, read from the build's contributor table
// (`contributors.generated.ts`: `host-service:<id>` → its `#machine` node;
// `list-catalog-in-sync` keeps it equal to the code). A suite that boots a graph
// of its own (the PGlite boot test) collects its own providers, which then
// answer instead.
//
// LAZILY, one provider at its service's first `get()`: every bun:test file runs
// in a process of its own (`./equin test`), and loading all ~24 providers up
// front evaluated ~1 s of the app's server graph in each of them (0.2 s → 1.1 s
// for a file with one trivial case; ~40 min of CPU over the 2.6k-file suite)
// for the few suites that read a service at all. `get()` is synchronous, so the
// provider is `require`d — every machine barrel loads without top-level await.
// Only providers load, never other machine halves: those would register
// resources (and jobs, channels) no suite asked for, and a suite booting a
// slice of the graph would then find them undeclared.
//
// A process that boots a graph of its OWN (a portable boot test's child, which
// sets `BOOTS_OWN_PLUGIN_GRAPH=1`) gets none of them: its graph collects its own
// providers, and loading the desktop's would evaluate their server code — a
// provider's whole import closure (the transcript reader reaches reports and
// config) — into a process whose graph does not hold it.
if (process.env.BOOTS_OWN_PLUGIN_GRAPH !== "1") {
  const { serverContributors } =
    await import("../plugins/framework/plugins/server-core/core/contributors.generated");
  const { provideHostServicesUnbooted } =
    await import("@plugins/framework/plugins/server-core/core");
  const loaded = new Map<string, readonly ServerContribution[]>();
  provideHostServicesUnbooted((serviceId) => {
    const hit = loaded.get(serviceId);
    if (hit !== undefined) return hit;
    // No row: nothing in the repo provides it — `get()` says "no provider".
    const nodes = serverContributors[`host-service:${serviceId}`] ?? [];
    const machine = nodes.filter((node) => node.endsWith("#machine"));
    if (machine.length > 1)
      throw new Error(
        `[bun-preload] host service "${serviceId}" has ${machine.length} desktop providers (${machine.join(", ")}) — the desktop boots exactly one.`,
      );
    const contributions = machine.flatMap((node) => {
      const barrel = join(
        PLUGINS_DIR,
        node.slice(0, -"#machine".length),
        "machine",
        "index.ts",
      );
      const mod = require(barrel) as {
        default: { contributions?: readonly ServerContribution[] };
      };
      return mod.default.contributions ?? [];
    });
    loaded.set(serviceId, contributions);
    return contributions;
  });
  // What the desktop's database driver loads at boot (its `ready()`) before
  // anything queries: suites use `db` without booting, so the stand-in boot
  // loads it here.
  const { loadDatabaseConfig } = await import("@plugins/database/core");
  await loadDatabaseConfig();
}

// Report sinks hold what is emitted while no handler is registered, and the
// hold is process-global: one `bun test` process runs many suites, so a report
// one suite's background work filed with no handler (a job's failed attempts)
// would be replayed into the first handler a LATER test registers — its
// collector failing on reports that are not its own. Every test starts with
// empty holds; a report emitted and then collected inside one test still is.
beforeEach(() => {
  discardHeldReports();
});
