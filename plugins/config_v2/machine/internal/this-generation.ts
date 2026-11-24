import { getBootMode } from "@plugins/framework/plugins/server-core/core";
import { asPluginId } from "@plugins/framework/plugins/plugin-id/core";
import { NAMESPACE_CONFIG_DIR, setConfigGenerationDir } from "./config-dir";
import { configGenerations, type ConfigGenerations } from "./generation";
import { readCommittedLayer } from "./repo-layer";
import { defineLogSink } from "@plugins/primitives/plugins/log-channels/server";

/** Every derive, promote and rollback of this namespace's config generations. */
const generationsLog = defineLogSink({
  id: "config-generations",
  description:
    "config_v2's config generations: each derive (source, moves, migrations, conflicts, timings), promote (HEAD moved, generation retired, generations collected), rollback, and the pre-generation writes a first derive could not carry",
});

let loaded: Promise<ConfigGenerations> | null = null;

/**
 * This process's view of its namespace's config generations: it runs the
 * code's `CONFIG_GENERATION`, derives it when it serves (an `exec` child only
 * reads the one its backend derived), from this code's committed layer and
 * the move ledger the build baked in.
 *
 * The generation module is loaded with a literal `import()`, not at module
 * eval: it is generated after the build has imported the barrels, so a barrel
 * reaching it statically would freeze a stale copy in the build's process
 * (`pre-barrel-manifests-complete`). A literal `import()` is still in the
 * backend's code closure, so a new generation still restarts the backend
 * rather than letting a deploy adopt it.
 */
export function thisGeneration(): Promise<ConfigGenerations> {
  loaded ??= (async () => {
    const { CONFIG_GENERATION, CONFIG_PLUGIN_MOVES } =
      await import("../../core/config-generation.generated");
    const generations = configGenerations({
      namespaceDir: NAMESPACE_CONFIG_DIR,
      generation: CONFIG_GENERATION,
      derives: () => getBootMode() !== "exec",
      readCommitted: readCommittedLayer,
      moves: CONFIG_PLUGIN_MOVES.map((m) => ({
        key: m.key,
        from: asPluginId(m.from),
        to: asPluginId(m.to),
        fromIsPlugin: m.fromIsPlugin,
      })),
      log: (line, stream) => generationsLog.publish(line, stream),
    });
    setConfigGenerationDir(generations.dir);
    return generations;
  })();
  return loaded;
}
