import { bootPluginGraph, type ServerRegistryEntry } from "../boot-stages";
import type { LoadedServerPlugin } from "../types";

/**
 * The one way a suite boots a plugin graph of its own: `bootPluginGraph` in
 * the `test` mode — the graph's schema OWNED (migrations, the derived layer,
 * the queue schema set up), since the suite's fresh database has no serving
 * backend to set it up. No mode to pick, so a test host cannot become an
 * `exec` schema verifier by accident: the four portable boot tests did,
 * failing with SchemaNotReadyError from 2026-11-15 (cda6e0e246).
 *
 * Returns the topo-sorted plugins, for a suite that goes on to the post-ready
 * phases (`runPostReadyPhases`).
 */
export function bootTestHost(spec: {
  entries: ServerRegistryEntry[];
}): Promise<LoadedServerPlugin[]> {
  return bootPluginGraph({
    mode: "test",
    listEntries: { kind: "not-shipped", reason: "a test boot" },
    entries: spec.entries,
  });
}
