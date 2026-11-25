import { rmdir, unlink } from "node:fs/promises";
import { readdir, stat } from "@plugins/packages/plugins/timed-fs/core";
import {
  APP_SCOPE_DIR,
  appScopeId,
  configFileRelPath,
  parseConfigFileRelPath,
  scopeSegment,
  storePathParts,
} from "../../core";
import type {
  ConfigDocRef,
  ConfigDocumentFile,
  ConfigFileRef,
  ConfigStoreImpl,
} from "../../core";
import { reloadConfigDocument } from "@plugins/config_v2/server";
import {
  defineAgentWriteLedger,
  type AgentWriteLedgerEntry,
  type FileSnapshot,
} from "@plugins/infra/plugins/request-origin/plugins/agent-write-ledger/server";
import {
  joinAppPath,
  type AppPath,
} from "@plugins/infra/plugins/host-fs/plugins/user-path/core";
import { configGenerationDir } from "./config-dir";
import { listConfigFiles } from "./list-files";
import { configFilesWatcherArmed, watchFileChange } from "./config-watcher";
import { configLedgerDocument, configLedgerKey } from "./config-ledger-key";
import { readConfigFile, writeConfigFile, writeRawAtomic } from "./jsonc-proxy";
import { generationOpener, thisGeneration } from "./this-generation";

/** Where a user-layer file lives on this machine. */
export function userFilePath(ref: ConfigFileRef): AppPath {
  return joinAppPath(configGenerationDir(), configFileRelPath(ref));
}

/** Every file a document is made of, for the agent-write ledger. */
function trioPaths(doc: ConfigDocRef): Record<ConfigDocumentFile, AppPath> {
  const path = (file: ConfigDocumentFile) => userFilePath({ ...doc, file });
  return {
    origin: path("origin"),
    override: path("override"),
    ancestor: path("ancestor"),
    merge: path("merge"),
  };
}

/**
 * The config documents an agent-origin request overwrote, held so the e2e
 * harness can put them back — config's ledger in the shared agent-write ledger
 * primitive. Design:
 * `research/2026-08-30-global-agent-config-write-revert-ledger.md`.
 *
 * Every registry write goes through the store's `edit`, which records the
 * document's whole trio here before the mutation and what it left after: a fork
 * writes the scoped origin as well as the override, an unfork removes both,
 * the conflict resolvers touch the ancestor. Capturing the trio uniformly is
 * correct for every write path, with no per-operation knowledge.
 */
const configWriteLedger = defineAgentWriteLedger<ConfigDocumentFile>({
  id: "config",
  label: "Config documents",
  restore: applyRestore,
});

/** Remove one file; a no-op when it is absent. */
async function removeIfPresent(path: AppPath): Promise<void> {
  try {
    await unlink(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/** Put one captured file back: exact bytes, or gone if it did not exist. */
async function restoreFile(
  path: AppPath,
  snapshot: FileSnapshot,
): Promise<void> {
  if (snapshot.present) {
    await writeRawAtomic(path, snapshot.bytes);
    return;
  }
  await removeIfPresent(path);
}

/**
 * Restore one ledgered document's files, then have the registry re-sync its
 * cache (`reloadConfigDocument`) — the watcher is a push-latency mechanism, not
 * a correctness one, so the restore cannot wait for its event.
 *
 * The ledger's `restore` for {@link configWriteLedger}; it has already checked
 * that no file moved since the agent's last write.
 */
async function applyRestore(
  entry: AgentWriteLedgerEntry<ConfigDocumentFile>,
): Promise<void> {
  const { storePath, scopeId } = configLedgerDocument(entry.key);
  // The same paths `trioPaths` recorded, rebuilt so they stay proven app-owned.
  for (const file of ["origin", "override", "ancestor", "merge"] as const) {
    // An entry recorded before the merge record existed captured no `merge`:
    // nothing of it to put back.
    const snapshot = entry.before[file] as FileSnapshot | undefined;
    if (snapshot === undefined) continue;
    await restoreFile(userFilePath({ storePath, scopeId, file }), snapshot);
  }
  await reloadConfigDocument(storePath, scopeId);
}

// Identity stamp for one file: "-" when absent, else (inode, mtime-ns, size).
//
// `ino` is what makes this airtight rather than merely likely. Every writer in
// this store goes through writeConfigFile, which writes a temp file and
// renames it into place — so the inode changes on EVERY write, including an
// acknowledge-conflict restamp that only swaps the 12 hex chars in the `// @hash`
// header and is therefore byte-length-identical (and can land in the same
// millisecond) as the file it replaced. mtime-ns + size then cover in-place
// writes from an external editor.
async function fileStamp(path: AppPath): Promise<string> {
  try {
    const st = await stat(path, { bigint: true });
    return `${st.ino}:${st.mtimeNs}:${st.size}`;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "-";
    throw err;
  }
}

/**
 * The desktop's user layer: this code's config generation
 * (`~/.equin/state/config/<namespace>/gens/<id>/`, derived by `open` when
 * new), one JSONC file per document file, watched by the config-files
 * watcher, every write fenced against the next generation's promote and every
 * agent-origin write ledgered.
 */
export const fileConfigStore: ConfigStoreImpl = {
  // This code's config generation: derived here when it is new (the serving
  // backend), waited for by an `exec` child.
  open: async (configs, schema) =>
    (await thisGeneration()).open(configs, generationOpener(schema)),
  read: (ref) => readConfigFile(userFilePath(ref), ref.file),
  write: (ref, content, hash) =>
    writeConfigFile(userFilePath(ref), content, hash),
  remove: (ref) => removeIfPresent(userFilePath(ref)),
  stamp: (ref) => fileStamp(userFilePath(ref)),
  // Every scope with a directory under the hierarchy's `@app/`. A missing
  // `@app` dir → [].
  async scopes(storePath) {
    const appDir = joinAppPath(
      configGenerationDir(),
      storePathParts(storePath).hier,
      APP_SCOPE_DIR,
    );
    let entries;
    try {
      entries = await readdir(appDir, { withFileTypes: true });
    } catch (err) {
      // A missing `@app` dir → [].
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => appScopeId(e.name));
  },
  async documentsWith(file) {
    const out: ConfigDocRef[] = [];
    for (const rel of await listConfigFiles(configGenerationDir())) {
      const ref = parseConfigFileRelPath(rel);
      if (ref.file !== file) continue;
      out.push(
        ref.scopeId === undefined
          ? { storePath: ref.storePath }
          : { storePath: ref.storePath, scopeId: ref.scopeId },
      );
    }
    return out;
  },
  async dropScope(storePath, scopeId) {
    const dir = joinAppPath(
      configGenerationDir(),
      storePathParts(storePath).hier,
      scopeSegment(scopeId),
    );
    try {
      await rmdir(dir);
    } catch (err) {
      // Gone already, or not empty (another descriptor still has files there,
      // or it's being cleaned by a concurrent op) — leave it. Anything else is
      // unexpected.
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTEMPTY") throw err;
    }
  },
  watch(doc, onChange) {
    const watches = (["override", "origin"] as const).map((file) =>
      watchFileChange(userFilePath({ ...doc, file }), onChange),
    );
    return {
      dispose: () => {
        for (const w of watches) w.dispose();
      },
    };
  },
  armed: configFilesWatcherArmed,
  async edit(doc, writer, operation, mutate) {
    // Fenced against the next generation's promote: refused once this
    // generation is retired, never lost between a derive and its promote.
    return (await thisGeneration()).withWrite(async () => {
      const key = configLedgerKey(doc.storePath, doc.scopeId ?? "");
      // A no-op for every writer but an agent; call immediately BEFORE the
      // mutation, and refresh "what the agent left" once it has landed.
      await configWriteLedger.record(writer, key, trioPaths(doc), operation);
      const result = await mutate();
      await configWriteLedger.noteComplete(writer, key);
      return result;
    });
  },
};
