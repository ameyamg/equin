/**
 * After `bun install` exits 0: is every OPTIONAL dependency this host needs
 * actually installed?
 *
 * Platform binaries ship as one npm package per os/cpu (`@equin/pgbouncer-*`,
 * `@equin/pg-client-*`, `@embedded-postgres/*`, `@napi-rs/keyring-*`,
 * `@anthropic-ai/claude-agent-sdk-*`, …), listed as `optionalDependencies` so
 * each host fetches only its own. bun treats a failed fetch of an optional
 * dependency as "not for this host" and says nothing: on 2026-11-27, right
 * after `@equin/pgbouncer-* 1.26.102` was published, the registry listed it
 * while the CDN still 404'd its tarball. `bun install` unlinked 1.26.101,
 * failed to fetch 1.26.102 (only `--verbose` showed the 404), printed "no
 * changes" and exited 0, leaving the checkout with no PgBouncer binary. The
 * failure surfaced later, far from its cause.
 *
 * The rule is npm's own and not specific to any package: an optional
 * dependency whose `os` / `cpu` / `libc` match this host is one the install
 * was meant to place. Those fields are read from `bun.lock`, where bun records
 * them for every package it resolved. The package's own manifest cannot be used
 * here, since a package that failed to fetch has none on disk.
 *
 * Which optional edges to check comes from walking what is installed. Each
 * workspace's declared dependencies (from `bun.lock`) and each installed
 * package's own `dependencies` / `optionalDependencies` are resolved the way
 * Node resolves them: up the directory tree from the dependent's real path,
 * through `node_modules`. That makes the check independent of bun's linker
 * (isolated or hoisted). An edge whose dependent is not installed is never
 * reached, so no edge is checked twice and none is guessed.
 *
 * PRE-INSTALL-SAFE, like `./ensure-deps.ts`: node builtins and `@plugins/*`
 * aliases only.
 */
import { dirname, join } from "node:path";
import {
  existsSync,
  readFileSync,
  realpathSync,
} from "@plugins/packages/plugins/timed-fs/core";
import { PRODUCT_NAME } from "@plugins/framework/plugins/product-name/core";

/** The host as npm's `os` / `cpu` / `libc` fields describe it. */
export interface HostPlatform {
  os: string;
  cpu: string;
  /** `glibc` / `musl` on Linux; `undefined` elsewhere (npm matches no `libc` there). */
  libc: string | undefined;
}

/** One optional dependency that matches this host and was not installed. */
export interface MissingPlatformPackage {
  /** The package that is missing. */
  name: string;
  /** Who declared it: a workspace path (`plugins/…`, `.` for the root) or an installed package's directory. */
  declaredBy: string;
  /** Its `os` / `cpu` / `libc` constraints as `bun.lock` records them. */
  constraints: string;
}

/** The `os` / `cpu` / `libc` metadata of a `bun.lock` package entry. */
interface PlatformMeta {
  os?: string | string[];
  cpu?: string | string[];
  libc?: string | string[];
}

interface Lockfile {
  workspaces: Record<string, WorkspaceEntry>;
  packages: Record<string, unknown[]>;
}

interface WorkspaceEntry {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface Manifest {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/** This process's host. libc follows the same test `detect-libc` uses. */
export function currentHostPlatform(): HostPlatform {
  if (process.platform !== "linux") {
    return { os: process.platform, cpu: process.arch, libc: undefined };
  }
  const report = (
    process as {
      report?: { getReport?: () => { header?: Record<string, unknown> } };
    }
  ).report?.getReport?.();
  const glibc = report?.header?.glibcVersionRuntime;
  return {
    os: process.platform,
    cpu: process.arch,
    libc: typeof glibc === "string" ? "glibc" : "musl",
  };
}

/**
 * npm's match for one field: a positive list, if any, must name the host, and
 * no `!negated` entry may. An absent field matches every host; a host with no
 * value for the field (libc off Linux) matches only an absent field.
 */
function fieldMatches(
  field: string | string[] | undefined,
  host: string | undefined,
): boolean {
  if (field === undefined) return true;
  const entries = Array.isArray(field) ? field : [field];
  if (host === undefined) return entries.length === 0;
  const positives = entries.filter((e) => !e.startsWith("!"));
  if (entries.includes(`!${host}`)) return false;
  return positives.length === 0 || positives.includes(host);
}

function matchesHost(meta: PlatformMeta, host: HostPlatform): boolean {
  return (
    fieldMatches(meta.os, host.os) &&
    fieldMatches(meta.cpu, host.cpu) &&
    fieldMatches(meta.libc, host.libc)
  );
}

function describeConstraints(meta: PlatformMeta): string {
  const parts = (["os", "cpu", "libc"] as const).flatMap((k) => {
    const v = meta[k];
    if (v === undefined) return [];
    return [`${k} ${Array.isArray(v) ? v.join(",") : v}`];
  });
  return parts.length > 0 ? parts.join(", ") : "no os/cpu constraint";
}

/**
 * The metadata object of a `bun.lock` package entry: the first plain object in
 * its tuple (`[ident, registry, meta, integrity]` for an npm package; a
 * workspace entry has none).
 */
function entryMeta(entry: unknown[]): PlatformMeta {
  const meta = entry.find(
    (e): e is PlatformMeta =>
      typeof e === "object" && e !== null && !Array.isArray(e),
  );
  return meta ?? {};
}

/**
 * The `bun.lock` entry for `name` as seen from a dependent whose own lock key
 * chain is `chain` (nearest last): bun nests a package that cannot be hoisted
 * under its dependent's key (`parent/child`), and falls back outward.
 */
function lockEntry(
  lock: Lockfile,
  chain: readonly string[],
  name: string,
): unknown[] | undefined {
  for (let i = chain.length - 1; i >= 0; i--) {
    const nested = lock.packages[`${chain[i]}/${name}`];
    if (nested) return nested;
  }
  return lock.packages[name];
}

/**
 * Node's resolution of `name` from `fromDir`, stopping at `root`; its real
 * directory, or `undefined`. `hasNodeModules` memoizes which directories have a
 * `node_modules` at all: most workspaces have none, so without it every
 * dependency of a deep workspace costs one stat per ancestor.
 */
function resolvePackageDir(
  fromDir: string,
  name: string,
  root: string,
  hasNodeModules: Map<string, boolean>,
): string | undefined {
  let dir = fromDir;
  for (;;) {
    let has = hasNodeModules.get(dir);
    if (has === undefined) {
      has = existsSync(join(dir, "node_modules"));
      hasNodeModules.set(dir, has);
    }
    const candidate = join(dir, "node_modules", name);
    if (has && existsSync(join(candidate, "package.json"))) {
      return realpathSync(candidate);
    }
    if (dir === root) return undefined;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function readLockfile(root: string): Lockfile {
  const path = join(root, "bun.lock");
  const parsed = Bun.JSONC.parse(
    readFileSync(path, "utf8"),
  ) as Partial<Lockfile>;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof parsed.workspaces !== "object" ||
    typeof parsed.packages !== "object"
  ) {
    throw new Error(
      `${PRODUCT_NAME}: ${path} has no "workspaces" / "packages" table — cannot check which platform packages this host needs.`,
    );
  }
  return parsed as Lockfile;
}

/**
 * Every optional dependency reachable from this checkout's workspaces that
 * matches `host` and is not installed. Empty when the install is whole.
 */
export function findMissingPlatformPackages(
  root: string,
  host: HostPlatform = currentHostPlatform(),
): MissingPlatformPackage[] {
  const lock = readLockfile(root);
  const realRoot = realpathSync(root);
  const missing: MissingPlatformPackage[] = [];
  const visited = new Set<string>();
  const hasNodeModules = new Map<string, boolean>();
  const queue: { dir: string; chain: string[] }[] = [];

  /** Resolve one declared dependency of the dependent at `dir`; queue it, or record it missing. */
  const follow = (
    dir: string,
    chain: string[],
    name: string,
    optional: boolean,
    declaredBy: string,
  ): void => {
    const resolved = resolvePackageDir(dir, name, realRoot, hasNodeModules);
    if (resolved !== undefined) {
      if (!visited.has(resolved)) {
        visited.add(resolved);
        const key =
          chain.length > 0 ? `${chain[chain.length - 1]}/${name}` : name;
        queue.push({
          dir: resolved,
          chain: [...chain, lock.packages[key] ? key : name],
        });
      }
      return;
    }
    // A required dependency bun could not place fails `bun install` itself;
    // only an optional one can go missing in silence.
    if (!optional) return;
    const entry = lockEntry(lock, chain, name);
    const meta = entry ? entryMeta(entry) : {};
    if (!matchesHost(meta, host)) return;
    missing.push({ name, declaredBy, constraints: describeConstraints(meta) });
  };

  for (const [path, ws] of Object.entries(lock.workspaces)) {
    const dir = path === "" ? realRoot : join(realRoot, path);
    const label = path === "" ? "." : path;
    const chain = ws.name ? [ws.name] : [];
    for (const deps of [ws.dependencies, ws.devDependencies]) {
      for (const name of Object.keys(deps ?? {})) {
        follow(dir, chain, name, false, label);
      }
    }
    for (const name of Object.keys(ws.optionalDependencies ?? {})) {
      follow(dir, chain, name, true, label);
    }
  }

  while (queue.length > 0) {
    const { dir, chain } = queue.pop()!;
    const manifest = JSON.parse(
      readFileSync(join(dir, "package.json"), "utf8"),
    ) as Manifest;
    const optional = manifest.optionalDependencies ?? {};
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      if (!(name in optional)) follow(dir, chain, name, false, dir);
    }
    for (const name of Object.keys(optional)) {
      follow(dir, chain, name, true, dir);
    }
  }

  return missing.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Throws, naming every missing package, when the install left out an optional
 * dependency this host needs. Called after `bun install` exits 0 and before
 * the stamp is written, so the next command installs again instead of
 * trusting a checkout with a binary missing.
 */
export function assertHostPlatformPackages(
  root: string,
  host: HostPlatform = currentHostPlatform(),
): void {
  const missing = findMissingPlatformPackages(root, host);
  if (missing.length === 0) return;
  const lines = missing.map(
    (m) => `    ${m.name} (${m.constraints}) — declared by ${m.declaredBy}`,
  );
  throw new Error(
    `${PRODUCT_NAME}: dependency install INCOMPLETE — \`bun install\` exited 0 ` +
      `but left out ${missing.length === 1 ? "an optional dependency" : `${missing.length} optional dependencies`} ` +
      `this host (${host.os} ${host.cpu}${host.libc ? ` ${host.libc}` : ""}) needs:\n` +
      `${lines.join("\n")}\n` +
      `  bun skips a failed fetch of an optional dependency without a word ` +
      `(a tarball the registry lists but its CDN still 404s right after a ` +
      `publish, a dropped connection, a failed postinstall). ` +
      `\`bun install --verbose\` shows the failed request.\n` +
      `  The dependency stamp was not written, so the next \`./${PRODUCT_NAME}\` ` +
      `command installs again; run \`./${PRODUCT_NAME} install\` once the ` +
      `package is fetchable.`,
  );
}
