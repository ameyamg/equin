// The reset's config read: a plain off-disk read (`config_v2/disk-read`), no
// build tooling in this process (`boot:closure-digestable`). There is no
// re-propagation step: a reset removes the namespace's config dir, and the
// backend it cold-starts derives a fresh generation from the committed layer.
import type { AppPath } from "@plugins/infra/plugins/host-fs/plugins/user-path/core";
import { asPath, asPluginId } from "@plugins/framework/plugins/plugin-id/core";
import { compositionsConfig } from "@plugins/plugin-meta/plugins/composition/core";
import { readEffectiveConfigFromDisk } from "@plugins/config_v2/plugins/disk-read/core";

// The `compositions` config's owning-plugin path — its jsonc files live under
// `config/<this>/` and the per-worktree user config dir (mirrors compose-serve).
const COMPOSITIONS_HIERARCHY_PATH = asPath(
  asPluginId("plugin-meta.composition"),
);

/** The checkout's resolved `compositions` config, as `userConfigDir` layers it. */
export async function readCompositionManifests(
  root: AppPath,
  userConfigDir: AppPath,
) {
  return readEffectiveConfigFromDisk(compositionsConfig, {
    root,
    userConfigDir,
    hierarchyPath: COMPOSITIONS_HIERARCHY_PATH,
  });
}
