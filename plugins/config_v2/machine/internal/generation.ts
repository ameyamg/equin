// Config generations, the desktop half: the backend whose code reads a user
// layer is the one that writes it.
//
// A namespace's user layer is one directory per config-relevant code version
// (`<ns>/gens/<CONFIG_GENERATION>/`, layout in `config_v2/core`). This process
// reads and writes its own for its whole life (`CONFIG_DIR`):
//
// - DERIVE (`open`, the file store's `open`, before the registry reads
//   anything — serve mode only): when this code's generation is not the one
//   HEAD names, take the namespace's generation lock, read HEAD's generation
//   (or the pre-generation flat layout) into memory, replay the plugin-move
//   ledger and every config migration (with the LIVE descriptors) over it,
//   propagate this code's committed layer into it, and write it out beside the
//   others. Nothing the serving backend reads is touched. The registry's boot
//   sweep then auto-merges stale overrides against this code's schema.
// - The lock stays held from the derive until the promote, so a write the
//   backend still serving makes meanwhile waits (`withWrite`): it lands either
//   before the clone (and is carried) or after the promote (and is refused) —
//   never in the gap, where it would be lost.
// - PROMOTE (`promote`, machine `onReady`, once the backend is ready — the
//   instant the gateway swaps it in): HEAD names this generation, the one it
//   replaced is marked retired, older ones are collected, the lock released.
// - FENCE: a write to a retired generation throws `ConfigGenerationRetired`;
//   a write to HEAD's generation holds the lock around itself, so it cannot
//   race a promote.
//
// A failed deploy never promotes: HEAD and every generation the serving
// backend reads stay as they were, and the derived one is derived again on the
// next attempt. The process dying releases the lock (it is a kernel flock).
//
// Design: research/2026-11-24-global-config-auto-merge.md § 5.

import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { dirname, join } from "node:path";
import {
  exists,
  readFile,
  readdir,
  stat,
} from "@plugins/packages/plugins/timed-fs/core";
import {
  flockTry,
  waitForFlock,
  type HeldFlock,
} from "@plugins/packages/plugins/flock/core";
import { openOwnedFd } from "@plugins/packages/plugins/owned-fd/core";
import { createSemaphore } from "@plugins/packages/plugins/semaphore/core";
import {
  joinAppPath,
  type AppPath,
} from "@plugins/infra/plugins/host-fs/plugins/user-path/core";
import { memoryConfigTree } from "./user-layer/config-tree";
import {
  APPLIED_CONFIG_MIGRATIONS_FILE,
  applyConfigMigrations,
} from "./user-layer/config-migrations";
import {
  APPLIED_MOVES_FILE,
  applyPluginMoves,
} from "./user-layer/plugin-moves";
import { propagateUserLayer } from "./user-layer/propagate-user-layer";
import {
  CONFIG_GENERATION_LOCK_FILE,
  CONFIG_GENERATION_RETIRED_FILE,
  CONFIG_GENERATION_ROOT_ENTRIES,
  CONFIG_GENS_DIR,
  CONFIG_HEAD_FILE,
  configHeadSchema,
  nextConfigHead,
  type CommittedFiles,
  type ConfigHead,
  type ConfigPluginMove,
  type RegisteredConfig,
} from "../../core";

/** A write refused because a newer backend's generation took over the namespace. */
export class ConfigGenerationRetired extends Error {
  constructor(generation: string, head: ConfigHead | null) {
    super(
      `[config-v2] config generation ${generation} is retired` +
        (head === null
          ? ""
          : ` (the namespace now serves ${head.generation})`) +
        ": a newer backend took over this namespace's config, so this write was refused rather than written where nothing reads it. Retry it — the new backend serves it.",
    );
    this.name = "ConfigGenerationRetired";
  }
}

/** This code's generation is not on disk, in a process that may not derive one. */
export class ConfigGenerationMissing extends Error {
  constructor(generation: string, why: string) {
    super(`[config-v2] config generation ${generation}: ${why}`);
    this.name = "ConfigGenerationMissing";
  }
}

/** What one namespace's generations are derived from, and where they live. */
export interface ConfigGenerationsSpec {
  /** The namespace's config dir (`configDir.file(<ns>)`). */
  namespaceDir: AppPath;
  /** This code's generation (`CONFIG_GENERATION`). */
  generation: string;
  /** Whether this process derives (a serving backend) or only reads (an `exec` child). */
  derives: () => boolean;
  /** The committed layer this code propagates. */
  readCommitted: () => Promise<CommittedFiles>;
  /** The plugin-move ledger this code was built with (`CONFIG_PLUGIN_MOVES`). */
  moves: readonly ConfigPluginMove[];
  /** Where a derive, a promote and what they could not carry are recorded. */
  log: (line: string, stream: "stdout" | "stderr") => void;
}

/** One namespace's config generations, as one process sees them. */
export interface ConfigGenerations {
  /** The user layer this process reads and writes. */
  readonly dir: AppPath;
  /** Derive this code's generation when it is new (serving backend) — the store's `open`. */
  open(configs: readonly RegisteredConfig[]): Promise<void>;
  /** Make the generation `open` derived the namespace's HEAD. A no-op when it derived none. */
  promote(): Promise<void>;
  /** Run one write to `dir`, fenced against another generation's promote. */
  withWrite<T>(write: () => Promise<T>): Promise<T>;
}

/**
 * What the pre-generation flat layout's root holds that is not config: the
 * generation machinery, and a generation's retired marker (a worktree fork
 * copies a served generation flat — one retired mid-copy carries it).
 */
const LEGACY_SKIP: ReadonlySet<string> = new Set([
  ...CONFIG_GENERATION_ROOT_ENTRIES,
  CONFIG_GENERATION_RETIRED_FILE,
]);

/** A ledger's marker file: the keys a generation applied. */
const appliedMarkerSchema = z.object({ applied: z.array(z.string()) });

/** How many user-layer files are read or written at once. */
const FILE_IO = 32;

/** A temp file of an atomic write still in flight: never part of a layer. */
const IN_FLIGHT_RE = /\.tmp-[^/]*$/;

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

/** Every regular file under `dir`, by dir-relative path — the root's `skip` entries left out. */
async function listLayer(
  dir: string,
  skip: ReadonlySet<string>,
): Promise<string[]> {
  const paths: string[] = [];
  const walk = async (rel: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(join(dir, rel), { withFileTypes: true });
    } catch (err) {
      if (rel === "" && (err as NodeJS.ErrnoException).code === "ENOENT")
        return;
      throw err;
    }
    await Promise.all(
      entries.map(async (e) => {
        if (rel === "" && skip.has(e.name)) return;
        const child = rel === "" ? e.name : `${rel}/${e.name}`;
        if (e.isDirectory()) await walk(child);
        else if (e.isFile() && !IN_FLIGHT_RE.test(e.name)) paths.push(child);
      }),
    );
  };
  await walk("");
  return paths;
}

/**
 * Every regular file under `dir`, by dir-relative path, with its text — the
 * root's `skip` entries left out.
 */
async function readLayer(
  dir: string,
  skip: ReadonlySet<string>,
): Promise<Map<string, string>> {
  const paths = await listLayer(dir, skip);
  const io = createSemaphore(FILE_IO);
  const files = new Map<string, string>();
  await Promise.all(
    paths.map((rel) =>
      io.run(async () => {
        files.set(rel, await readFile(join(dir, rel), "utf8"));
      }),
    ),
  );
  return files;
}

/** `(inode, mtime, size)` of each of `paths` under `dir` ("-" when gone). */
async function stampsOf(
  dir: string,
  paths: Iterable<string>,
): Promise<Map<string, string>> {
  const io = createSemaphore(FILE_IO);
  const out = new Map<string, string>();
  await Promise.all(
    [...paths].map((rel) =>
      io.run(async () => {
        try {
          const st = await stat(join(dir, rel), { bigint: true });
          out.set(rel, `${st.ino}:${st.mtimeNs}:${st.size}`);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
          out.set(rel, "-");
        }
      }),
    ),
  );
  return out;
}

async function writeLayer(
  dir: string,
  files: ReadonlyMap<string, string>,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const dirs = new Set<string>();
  for (const rel of files.keys()) {
    const parent = dirname(rel);
    if (parent !== ".") dirs.add(parent);
  }
  await Promise.all(
    [...dirs].map((d) => mkdir(join(dir, d), { recursive: true })),
  );
  const io = createSemaphore(FILE_IO);
  await Promise.all(
    [...files].map(([rel, text]) =>
      io.run(() => writeFile(join(dir, rel), text)),
    ),
  );
}

/** Held from the derive to the promote: what the promote needs. */
interface BootHold {
  lock: HeldFlock;
  /** The legacy root's files' stamps at the clone, when it was the source. */
  legacy: Map<string, string> | null;
}

/** One namespace's config generations, for the process running `spec.generation`. */
export function configGenerations(
  spec: ConfigGenerationsSpec,
): ConfigGenerations {
  const own = spec.generation;
  const nsDir = spec.namespaceDir;
  const gensDir = joinAppPath(nsDir, CONFIG_GENS_DIR);
  const dir = joinAppPath(gensDir, own);
  const headPath = joinAppPath(nsDir, CONFIG_HEAD_FILE);
  const lockPath = joinAppPath(nsDir, CONFIG_GENERATION_LOCK_FILE);
  const retiredPath = joinAppPath(dir, CONFIG_GENERATION_RETIRED_FILE);
  let bootHold: BootHold | null = null;
  /** Set when the promote failed: every write is refused from then on. */
  let promoteFailure: unknown = null;
  /** True inside a fenced write: a nested one runs under the same lock. */
  const inFencedWrite = new AsyncLocalStorage<true>();
  /** One write at a time per process takes the lock. */
  const fencedWrites = createSemaphore(1);

  async function readHead(): Promise<ConfigHead | null> {
    let text: string;
    try {
      text = await readFile(headPath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    return configHeadSchema.parse(JSON.parse(text));
  }

  /** The namespace's generation lock, waited for without holding the thread. */
  async function acquireLock(): Promise<HeldFlock> {
    await mkdir(nsDir, { recursive: true });
    const fd = await openOwnedFd(lockPath, "a");
    if (flockTry(fd.fd)) {
      const release = () => {
        if (!fd.closed) fd.close();
      };
      return { releaseNow: release, release: async () => release() };
    }
    fd.close();
    return waitForFlock(lockPath);
  }

  /**
   * Derive this code's generation from `head`'s (or the legacy flat layout)
   * into `dir`. Runs under the lock. Returns the legacy root's stamps when it
   * was the source.
   */
  async function derive(
    head: ConfigHead | null,
    configs: readonly RegisteredConfig[],
  ): Promise<Map<string, string> | null> {
    const started = performance.now();
    const source = head === null ? nsDir : join(gensDir, head.generation);
    if (head !== null && !(await isDirectory(source)))
      throw new Error(
        `[config-v2] ${headPath} names generation ${head.generation}, but ${source} is not on disk`,
      );
    const files = await readLayer(
      source,
      head === null ? LEGACY_SKIP : new Set([CONFIG_GENERATION_RETIRED_FILE]),
    );
    const legacy = head === null ? await stampsOf(source, files.keys()) : null;
    const sourceFiles = files.size;
    const read = performance.now();

    const tree = memoryConfigTree(files);
    const committed = await spec.readCommitted();
    const prepared = performance.now();
    const appliedMoves = applyPluginMoves({
      tree,
      moves: spec.moves,
      committed,
      fresh: sourceFiles === 0,
    });
    const migrations = applyConfigMigrations({ tree, configs });
    const { conflicts } = propagateUserLayer({ tree, committed, configs });
    const derived = performance.now();

    const temp = join(gensDir, `.derive-${own}-${process.pid}`);
    await rm(temp, { recursive: true, force: true });
    await writeLayer(temp, tree.files);
    // A generation left by a deploy that never promoted: derived again from
    // the current HEAD, whose writes since it does not hold.
    await rm(dir, { recursive: true, force: true });
    await rename(temp, dir);
    const ms = (t: number) => Math.round(t);
    spec.log(
      `[config-v2] derived config generation ${own} from ${head === null ? "the pre-generation layout" : `generation ${head.generation}`}: ` +
        `${sourceFiles} files in, ${tree.files.size} out; ${appliedMoves.length} plugin move(s), ${migrations.length} migration(s), ${conflicts.length} conflict(s); ` +
        `read ${ms(read - started)} ms, committed layer ${ms(prepared - read)} ms, derive ${ms(derived - prepared)} ms, write ${ms(performance.now() - derived)} ms`,
      "stdout",
    );
    for (const m of migrations)
      spec.log(
        `[config-v2] config migration ${m.key}: rewrote ${m.rewritten.length} file(s)`,
        "stdout",
      );
    for (const a of appliedMoves)
      spec.log(
        `[config-v2] plugin move ${a.move.from} → ${a.move.to}: moved ${a.moved.length} saved file(s), rewrote ${a.rewritten.length}` +
          (a.kept.length > 0
            ? `; kept ${a.kept.length} at the old path (the destination already had one): ${a.kept.join(", ")}`
            : ""),
        "stdout",
      );
    return legacy;
  }

  /**
   * The ledger keys HEAD's generation applied (plugin moves, config
   * migrations) that this code does not declare — what makes deriving this
   * code's generation from it impossible.
   */
  async function ledgerKeysUnknownTo(
    head: ConfigHead,
    configs: readonly RegisteredConfig[],
  ): Promise<string[]> {
    const known = new Set<string>([
      ...spec.moves.map((m) => m.key),
      ...configs.flatMap(({ hierarchyPath, descriptor }) =>
        (descriptor.migrations ?? []).map(
          (m) => `${hierarchyPath}/${descriptor.name}:${m.id}`,
        ),
      ),
    ]);
    const unknown: string[] = [];
    for (const marker of [APPLIED_MOVES_FILE, APPLIED_CONFIG_MIGRATIONS_FILE]) {
      let text: string;
      try {
        text = await readFile(join(gensDir, head.generation, marker), "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw err;
      }
      for (const key of appliedMarkerSchema.parse(JSON.parse(text)).applied)
        if (!known.has(key)) unknown.push(key);
    }
    return unknown;
  }

  async function open(configs: readonly RegisteredConfig[]): Promise<void> {
    if (!spec.derives()) {
      if (!(await isDirectory(dir)))
        throw new ConfigGenerationMissing(
          own,
          `${dir} does not exist — only the serving backend derives a generation, and this namespace's has not booted this code`,
        );
      return;
    }
    const head = await readHead();
    if (head?.generation === own && (await isDirectory(dir))) return;
    const lock = await acquireLock();
    try {
      const current = await readHead();
      if (current?.generation === own && (await isDirectory(dir))) {
        // Another process of this code derived and promoted it meanwhile.
        await lock.release();
        return;
      }
      let legacy: Map<string, string> | null = null;
      const unreadable =
        current?.history.includes(own) === true
          ? await ledgerKeysUnknownTo(current, configs)
          : [];
      if (unreadable.length > 0) {
        // Older code coming back (a rollback) to a namespace whose served
        // generation applied a migration or a move this code does not know:
        // that shape cannot be derived back down (migrations are one-way), so
        // the generation this code served before is reused as it was — or,
        // collected since, the boot fails.
        if (!(await isDirectory(dir)))
          throw new ConfigGenerationMissing(
            own,
            `it served this namespace before ${current!.generation}, which applied what this code does not know (${unreadable.join(", ")}), and it has since been collected — config cannot be derived back to older code`,
          );
        spec.log(
          `[config-v2] rolling back to config generation ${own}: ${current!.generation} applied what this code does not know (${unreadable.join(", ")}), so config written under it since is not carried over`,
          "stderr",
        );
      } else {
        // A new generation — or one this code served before, when the one
        // served now applied nothing it does not know (a reverted config
        // change): derived again from what is served, so writes made since
        // carry over.
        legacy = await derive(current, configs);
      }
      bootHold = { lock, legacy };
    } catch (err) {
      await lock.release();
      throw err;
    }
  }

  /** Remove every generation but `keep` (HEAD and the one it replaced). */
  async function collect(keep: ReadonlySet<string>): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(gensDir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const removed: string[] = [];
    for (const e of entries) {
      if (!e.isDirectory() || keep.has(e.name)) continue;
      // Under the lock: no derive is in flight, so a `.derive-*` dir is one a
      // dead process left.
      await rm(join(gensDir, e.name), { recursive: true, force: true });
      removed.push(e.name);
    }
    return removed;
  }

  async function promote(): Promise<void> {
    const hold = bootHold;
    if (hold === null) return;
    try {
      const previous = await readHead();
      const next = nextConfigHead(previous, own);
      const temp = `${headPath}.tmp-${process.pid}`;
      await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`);
      await rename(temp, headPath);
      await rm(retiredPath, { force: true });
      const replaced = previous?.generation;
      if (
        replaced !== undefined &&
        replaced !== own &&
        (await isDirectory(join(gensDir, replaced)))
      ) {
        await writeFile(
          join(gensDir, replaced, CONFIG_GENERATION_RETIRED_FILE),
          `retired by generation ${own} at ${new Date().toISOString()}\n`,
        );
      }
      const collected = await collect(
        new Set([own, ...(replaced === undefined ? [] : [replaced])]),
      );
      spec.log(
        `[config-v2] promoted config generation ${own}` +
          (replaced === undefined ? "" : ` over ${replaced}`) +
          (collected.length > 0 ? `; collected ${collected.join(", ")}` : ""),
        "stdout",
      );
      if (hold.legacy !== null) {
        // A pre-generation backend writes the flat layout without this lock,
        // so a file it wrote or created after the clone is in no generation.
        // Never dropped silently: named here, still on disk at the root.
        const paths = new Set([
          ...hold.legacy.keys(),
          ...(await listLayer(nsDir, LEGACY_SKIP)),
        ]);
        const now = await stampsOf(nsDir, paths);
        const moved = [...paths].filter(
          (rel) => now.get(rel) !== (hold.legacy!.get(rel) ?? "-"),
        );
        if (moved.length > 0)
          spec.log(
            `[config-v2] ${moved.length} file(s) of the pre-generation layout were written while generation ${own} was derived from it, and are not in it (still at ${nsDir}): ${moved.join(", ")}`,
            "stderr",
          );
      }
    } catch (err) {
      // HEAD may not name this generation: a write here could land where the
      // next derive does not read. Refuse every write from now on, loudly.
      promoteFailure = err;
      throw err;
    } finally {
      bootHold = null;
      await hold.lock.release();
    }
  }

  async function withWrite<T>(write: () => Promise<T>): Promise<T> {
    if (promoteFailure !== null)
      throw new Error(
        `[config-v2] config generation ${own} failed to become the namespace's HEAD, so config writes are refused (a write could be lost)`,
        { cause: promoteFailure },
      );
    // This process holds the lock itself — from its derive to its promote, or
    // around the write this one is nested in (an edit's refresh stamping an
    // override): run as is, never wait on our own lock.
    if (bootHold !== null || inFencedWrite.getStore() === true) return write();
    const head = await readHead();
    if (head?.generation !== own) {
      // Not HEAD's: retired, or not promoted yet (a booting backend's `exec`
      // children) — a generation that is not HEAD's cannot be retired under
      // the write, so it runs as is.
      if (await exists(retiredPath))
        throw new ConfigGenerationRetired(own, head);
      return write();
    }
    return fencedWrites.run(async () => {
      const lock = await acquireLock();
      try {
        if (await exists(retiredPath))
          throw new ConfigGenerationRetired(own, await readHead());
        return await inFencedWrite.run(true, write);
      } finally {
        await lock.release();
      }
    });
  }

  return { dir, open, promote, withWrite };
}
