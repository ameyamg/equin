import {
  APP_SCOPE_DIR,
  appScopeId,
  committedDocument,
  configFileRelPath,
  parseOverrideFile,
  propagateGitLayerDocument,
  type CommittedFiles,
  type ConfigDescriptor,
  type ConfigDocRef,
  type ConfigProxy,
  type JsonValue,
} from "../../../core";
import type { ConfigTree } from "./config-tree";

/** One user-layer file of `tree` as a ConfigProxy, in the file store's byte format. */
export function treeConfigProxy(tree: ConfigTree, path: string): ConfigProxy {
  return {
    read() {
      const text = tree.read(path);
      // The lenient override reading (header optional, syntax errors kept),
      // so propagation never stamps — rewrites — a file that does not parse.
      return text === null ? null : parseOverrideFile(text);
    },
    write(content: JsonValue, hash: string | null) {
      tree.write(
        path,
        `${hash === null ? "" : `// @hash ${hash}\n`}${JSON.stringify(content, null, 2)}\n`,
      );
    },
    exists() {
      return tree.read(path) !== null;
    },
  };
}

/**
 * Propagate the committed layer into one namespace's user layer: for every
 * config, its committed document becomes the user origin — base and each
 * committed `@app/<id>` scope — through `propagateGitLayerDocument`, the one
 * propagation a memory store seeding itself runs too, so an override written
 * against an older upstream keeps its merge base (the ancestor) and turns into
 * a conflict rather than being lost. Then:
 *
 * - an ancestor left by a document no longer in conflict is removed, so it can
 *   never seed a stale merge base later;
 * - a scoped origin with no committed scope behind it (a scope removed from
 *   git) is removed — unless a user override (a runtime fork) sits beside it.
 *
 * Returns the documents left in conflict, for the caller to report.
 */
export function propagateUserLayer(opts: {
  tree: ConfigTree;
  committed: CommittedFiles;
  configs: readonly { hierarchyPath: string; descriptor: ConfigDescriptor }[];
}): { conflicts: ConfigDocRef[] } {
  const { tree, committed, configs } = opts;
  const all: ConfigDocRef[] = [];
  for (const { hierarchyPath, descriptor } of configs) {
    const storePath = `${hierarchyPath}/${descriptor.name}.jsonc`;
    const gitLayer = committedDocument(storePath, committed);
    if (gitLayer === undefined) continue;

    const { conflicts } = propagateGitLayerDocument(
      storePath,
      gitLayer,
      (ref) => treeConfigProxy(tree, configFileRelPath(ref)),
    );
    all.push(...conflicts);

    const propagated: ConfigDocRef[] = [
      { storePath },
      ...Object.keys(gitLayer.scopes).map((appId) => ({
        storePath,
        scopeId: appScopeId(appId),
      })),
    ];
    for (const ref of propagated) {
      if (conflicts.some((c) => c.scopeId === ref.scopeId)) continue;
      tree.remove(configFileRelPath({ ...ref, file: "ancestor" }));
    }

    // A user scoped origin with NO git backing is a scope removed from version
    // control — revert it to base so git stays the source of truth. A runtime
    // fork (a scoped override with no git backing) is per-user state: kept.
    const committedScopes = new Set(Object.keys(gitLayer.scopes));
    const scopePrefix = `${hierarchyPath}/${APP_SCOPE_DIR}/`;
    const originName = `/${descriptor.name}.origin.jsonc`;
    for (const path of tree.paths()) {
      if (!path.startsWith(scopePrefix) || !path.endsWith(originName)) continue;
      const appId = path.slice(scopePrefix.length, -originName.length);
      if (appId.includes("/") || committedScopes.has(appId)) continue;
      const fork = `${scopePrefix}${appId}/${descriptor.name}.jsonc`;
      if (tree.read(fork) !== null) continue;
      tree.remove(path);
    }
  }
  return { conflicts: all };
}
