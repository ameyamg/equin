import {
  existsSync,
  readFile,
  readFileSync,
} from "@plugins/packages/plugins/timed-fs/core";
import {
  joinAppPath,
  type AppPath,
} from "@plugins/infra/plugins/host-fs/plugins/user-path/core";
import {
  CONFIG_GENS_DIR,
  CONFIG_HEAD_FILE,
  configHeadSchema,
  type ConfigHead,
} from "@plugins/config_v2/core";

function parseHead(path: string, text: string): ConfigHead {
  try {
    return configHeadSchema.parse(JSON.parse(text));
  } catch (err) {
    throw new Error(`[config-v2] ${path} is not a config HEAD`, { cause: err });
  }
}

function servedFrom(namespaceDir: AppPath, head: ConfigHead | null): AppPath {
  return head === null
    ? namespaceDir
    : joinAppPath(namespaceDir, CONFIG_GENS_DIR, head.generation);
}

/**
 * The user config layer a namespace serves, given its config dir
 * (`configDir.file(<ns>)`, `config_v2/data-dirs`): the generation its `HEAD`
 * names (`<ns>/gens/<id>/`), or the namespace dir itself while it has no
 * `HEAD` (a namespace no generation-aware backend has booted yet — the legacy
 * flat layout). What every reader of a namespace's config off disk reads.
 */
export async function servedConfigDir(namespaceDir: AppPath): Promise<AppPath> {
  const path = joinAppPath(namespaceDir, CONFIG_HEAD_FILE);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT")
      return servedFrom(namespaceDir, null);
    throw err;
  }
  return servedFrom(namespaceDir, parseHead(path, text));
}

/** {@link servedConfigDir}, holding the thread: for a CLI step that may block. */
export function servedConfigDirSync(namespaceDir: AppPath): AppPath {
  const path = joinAppPath(namespaceDir, CONFIG_HEAD_FILE);
  if (!existsSync(path)) return servedFrom(namespaceDir, null);
  return servedFrom(namespaceDir, parseHead(path, readFileSync(path, "utf8")));
}
