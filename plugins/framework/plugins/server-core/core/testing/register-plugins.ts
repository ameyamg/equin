import { runRegisterPhase, type ServerRegistryEntry } from "../boot-stages";
import { machineEntries } from "../machine.generated";
import { serverEntries } from "../server.generated";
import type { LoadedServerPlugin, Registration } from "../types";

// Tokens this process already registered through here: the `bun test` process
// runs every suite in one process, and a registry refuses a second
// registration of the same name — so two suites naming one plugin register
// each token once.
const registered = new WeakSet<Registration>();

/**
 * Run the `register` tokens `select` keeps of `pluginPaths` the way a booted
 * desktop host does, for a headless suite (an unbooted host): each plugin's
 * `register` list — its server half's, then its machine half's — read from the
 * app's generated registries and run through the boot's own register phase
 * (so a registry records the plugin it was declared in).
 *
 * The production source, never a hand-picked token: a registry kind's own
 * testing barrel wraps this with its selector (jobs' `registerPluginJobs`), so
 * a suite names the PLUGIN, and loses the registration exactly when the plugin
 * drops it from its `register` list. Selected, not whole: a plugin's other
 * tokens (runtimes, workspace kinds) would collide with the fakes other suites
 * of the same process install.
 *
 * Idempotent per token within the process. A plugin in neither registry fails
 * loudly.
 */
export async function registerPluginTokens(
  pluginPaths: readonly string[],
  select: (token: Registration) => boolean,
): Promise<void> {
  const halves: ServerRegistryEntry[] = [];
  for (const path of pluginPaths) {
    const found = [...serverEntries, ...machineEntries].filter(
      (e) => e.pluginPath === path,
    );
    if (found.length === 0) {
      throw new Error(
        `[registerPluginTokens] "${path}" has no server or machine barrel in the app's registries`,
      );
    }
    halves.push(...found);
  }
  for (const entry of halves) {
    const mod = (await entry.loader()) as { default: LoadedServerPlugin };
    const tokens = (mod.default.register ?? []).filter(
      (t) => select(t) && !registered.has(t),
    );
    // Marked once registered: a token that throws stays unmarked, and the
    // throw fails the suite.
    await runRegisterPhase([{ id: entry.id, register: tokens }]);
    for (const t of tokens) registered.add(t);
  }
}
