import { HttpError } from "@plugins/infra/plugins/endpoints/server";
import { implementMachine } from "@plugins/infra/plugins/endpoints/machine";
import { originOf } from "@plugins/infra/plugins/request-origin/core";
import type { WriteOrigin } from "@plugins/infra/plugins/request-origin/core";
import { parseConfigFileRelPath } from "@plugins/config_v2/core";
import type { ConfigFileRef, OrphanEntry } from "@plugins/config_v2/core";
import { ConfigStore } from "@plugins/config_v2/server";
import { discardConfigOrphanEndpoint } from "../../shared/discard";
import { auditUserConfigOrphans } from "./orphan-audit";
import { configOrphansReportServed } from "./report-resource";

/**
 * Remove one orphan's files from the served generation, one store edit per
 * document (base, then each `@app/<id>` scope) so the generation lock fences
 * each against a derive → promote and an agent's write is ledgered per
 * document, as every config write is. A scope's container is dropped once
 * empty. Returns the removed paths.
 */
export async function discardOrphan(
  entry: OrphanEntry,
  writer: WriteOrigin,
): Promise<string[]> {
  const store = ConfigStore.get();
  const byDoc = new Map<
    string,
    { storePath: string; scopeId?: string; refs: ConfigFileRef[] }
  >();
  for (const f of entry.files) {
    const ref = parseConfigFileRelPath(f.relPath);
    const key = `${ref.storePath}\0${ref.scopeId ?? ""}`;
    let doc = byDoc.get(key);
    if (!doc)
      byDoc.set(
        key,
        (doc = {
          storePath: ref.storePath,
          ...(ref.scopeId !== undefined ? { scopeId: ref.scopeId } : {}),
          refs: [],
        }),
      );
    doc.refs.push(ref);
  }
  for (const { refs, ...doc } of byDoc.values()) {
    await store.edit(doc, writer, "discard-orphan", async () => {
      for (const ref of refs) await store.remove(ref);
      if (doc.scopeId !== undefined)
        await store.dropScope(doc.storePath, doc.scopeId);
    });
  }
  return entry.files.map((f) => f.relPath);
}

export const handleDiscardConfigOrphan = implementMachine(
  discardConfigOrphanEndpoint,
  async ({ body, req }) => {
    // Re-audited now, never trusted from the caller: only a config no live
    // descriptor reads may be removed here.
    const entry = (await auditUserConfigOrphans()).orphans.find(
      (o) => o.storeKey === body.storeKey,
    );
    if (!entry) {
      throw new HttpError(
        409,
        `"${body.storeKey}" is not an orphaned config (a live config reads it, or it has no files left) — nothing discarded.`,
      );
    }
    const removed = await discardOrphan(entry, originOf(req));
    // The writer refreshes what it changed: the dir watcher is push latency,
    // not correctness (config_v2 — a missed event must not leave the row up).
    configOrphansReportServed.notify();
    return { removed };
  },
);
