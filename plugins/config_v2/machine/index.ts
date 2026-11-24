import type { MachinePluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { ConfigGitLayer, ConfigStore } from "@plugins/config_v2/server";
import {
  configFilesWatcher,
  initConfigWatcher,
  shutdownConfigWatcher,
} from "./internal/config-watcher";
import { fileConfigStore } from "./internal/file-store";
import { repoConfigLayer } from "./internal/repo-layer";
import { configRawFileServed } from "./internal/raw-file";
import { thisGeneration } from "./internal/this-generation";

export { configGenerationDir } from "./internal/config-dir";

export default {
  description:
    "The desktop's config host services: the user layer as JSONC files in this code's config generation under the namespace's config dir — derived at boot by the serving backend (plugin moves, migrations, propagation) and promoted to the namespace's HEAD once it serves; watched, every write fenced against the next generation's promote, every agent-origin write ledgered for revert — and the committed layer read from the checkout's config/, plus the raw-file view of a document's four files.",
  contributions: [
    ConfigStore.provide(fileConfigStore),
    ConfigGitLayer.provide(repoConfigLayer),
    ...configRawFileServed.declare,
  ],
  register: [configFilesWatcher],
  async onReady() {
    // Ready is when the gateway swaps this backend in: from here this code's
    // config generation is the one served — HEAD moves to it (when this boot
    // derived it), and the backend it replaced has its writes refused.
    await (await thisGeneration()).promote();
    // Background: the file watcher only needs to catch later edits.
    await initConfigWatcher();
  },
  async onShutdown() {
    await shutdownConfigWatcher();
  },
} satisfies MachinePluginDefinition;
