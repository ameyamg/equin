import { runtimeNamespace } from "@plugins/infra/plugins/runtime-identity/core";
import type { AppPath } from "@plugins/infra/plugins/host-fs/plugins/user-path/core";
import { configDir } from "../../data-dirs";

/**
 * This namespace's subtree of the declared user-config directory: its config
 * generations and the HEAD naming the one served (`config_v2/core`'s
 * generation layout).
 *
 * Resolved at MODULE EVAL, which is why `bin/index.ts` declares the runtime
 * namespace in its very first statement: without one this throws. Only the
 * machine half (and the machine halves that read the config dir) reach it — the
 * portable registry every `ConfigV2` importer loads names no directory.
 */
export const NAMESPACE_CONFIG_DIR = configDir.file(runtimeNamespace());

let generationDir: AppPath | null = null;

/** Set once, by `./this-generation.ts`, when the store opens. */
export function setConfigGenerationDir(dir: AppPath): void {
  if (generationDir !== null && generationDir !== dir)
    throw new Error(
      `[config-v2] the config generation dir is ${generationDir}; refusing ${dir}`,
    );
  generationDir = dir;
}

/**
 * The user layer THIS code reads and writes: its own config generation,
 * `<namespace>/gens/<CONFIG_GENERATION>/`, for the process's lifetime — the
 * root of the desktop's user-layer store. Known once the store has opened
 * (the registry opens it before reading any document); a read before that is
 * a bug, and throws.
 */
export function configGenerationDir(): AppPath {
  if (generationDir === null)
    throw new Error(
      "[config-v2] the config generation dir was read before the config store opened",
    );
  return generationDir;
}
