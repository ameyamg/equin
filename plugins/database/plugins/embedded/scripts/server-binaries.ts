// The server binaries' own facts, shared by the start script and the smoke
// test (`smoke.ts`): their major version and the library aliases they load.
import { symlinkSync } from "node:fs";
import {
  existsSync,
  lstatSync,
  readFileSync,
} from "@plugins/packages/plugins/timed-fs/core";
import { basename, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

/** The major version of the server at `binDir`, as `postgres --version` says. */
export function serverMajor(binDir: string): number {
  const result = spawnSync(join(binDir, "postgres"), ["--version"], {
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  const m = /\(PostgreSQL\) (\d+)/.exec(result.stdout);
  if (result.status !== 0 || m === null) {
    throw new Error(
      `pg: \`${join(binDir, "postgres")} --version\` did not name a version (exit ${result.status}): ${result.stdout}${result.stderr}`,
    );
  }
  return Number(m[1]);
}

/**
 * Hydrate the unversioned library aliases PG's loader needs (`libicuuc.dylib`,
 * `libicuuc.so.60`, …) from the manifest shipped inside the platform package.
 *
 * This is the ONLY thing that creates them. The platform package declares a
 * `postinstall` (`hydrate-symlinks.js`) that would, but bun does not run
 * lifecycle scripts for untrusted dependencies and nothing in this repo lists
 * these packages in `trustedDependencies` — so the manifest is load-bearing on
 * every install and, more sharply, on every shipped release: a cross-built
 * bundle's native tree has never been hydrated by anything on the build host, so
 * the aliases come into existence on the target box or not at all.
 *
 * Hence no early return on a missing manifest. Absent, PG fails much later with
 * a missing-shared-library error naming a file nobody ever asked for; here we can
 * still name the real cause.
 */
export function ensureSymlinks(binDir: string): void {
  const pkgRoot = dirname(dirname(binDir)); // native/bin -> package root
  const manifestPath = join(pkgRoot, "native", "pg-symlinks.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      [
        `pg: symlink manifest not found at ${manifestPath}`,
        "",
        "Every @embedded-postgres/<platform> package ships this file in its `native/`",
        "dir, and it is what creates the unversioned library aliases PG's loader",
        "resolves against — without it the cluster cannot start.",
        "",
        "A release bundle gets it from `cpSync` of the whole `native/` tree; if it is",
        "missing here, that vendoring step dropped it. In dev, re-run `bun install`.",
      ].join("\n"),
    );
  }

  const entries: Array<{ source: string; target: string }> = JSON.parse(
    readFileSync(manifestPath, "utf-8"),
  );
  for (const { source, target } of entries) {
    const linkPath = join(pkgRoot, target);
    try {
      lstatSync(linkPath);
      continue; // already exists
      // eslint-disable-next-line promise-safety/no-bare-catch
    } catch {}
    try {
      symlinkSync(basename(source), linkPath);
    } catch (err: any) {
      if (err.code !== "EEXIST") throw err;
    }
  }
}
