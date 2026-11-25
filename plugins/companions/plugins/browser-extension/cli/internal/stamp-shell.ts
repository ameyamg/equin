import { createSha256 } from "@plugins/packages/plugins/string-hash/core";

/**
 * What the build writes where the shell's build goes, before it is known: the
 * scripts' `__SHELL_BUILD__` (a Bun `define`) and the manifest's
 * `version_name`.
 */
export const SHELL_BUILD_PLACEHOLDER = "@@SHELL_BUILD@@";

/** Files the stamp is written into (the rest — icons — are bytes). */
const TEXT_FILE = /\.(js|json|html)$/;

/**
 * Stamp the shell with its build: the digest of every file it ships, taken
 * with the placeholder still in place, then written over the placeholder in
 * every text file — the manifest's `version_name` and every script's
 * `SHELL_BUILD` alike. So a change to ANY part of the shell is a new
 * manifest, and each part can tell whether Chrome runs its build (Chrome
 * reloads the manifest and the worker only on an extension reload, while it
 * reads the popup, offscreen and content scripts from disk on each open).
 */
export function stampShell(files: ReadonlyMap<string, Buffer>): {
  digest: string;
  files: Map<string, Buffer>;
} {
  const manifest = files.get("manifest.json");
  if (
    manifest === undefined ||
    (JSON.parse(manifest.toString()) as { version_name?: unknown })
      .version_name !== SHELL_BUILD_PLACEHOLDER
  )
    throw new Error(
      `the shell's manifest.json must carry version_name ${SHELL_BUILD_PLACEHOLDER}`,
    );
  const hasher = createSha256();
  for (const [name, bytes] of [...files].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  ))
    hasher.update(name).update(bytes);
  const digest = hasher.hex();
  const stamped = new Map<string, Buffer>();
  for (const [name, bytes] of files)
    stamped.set(
      name,
      TEXT_FILE.test(name)
        ? Buffer.from(
            bytes.toString().replaceAll(SHELL_BUILD_PLACEHOLDER, digest),
          )
        : bytes,
    );
  return { digest, files: stamped };
}
