import { getConfig } from "@plugins/config_v2/server";
import {
  classifyEdges,
  flattenManifest,
  resolveComposition,
  type EdgeGraph,
} from "@plugins/plugin-meta/plugins/closure/core";
import {
  compositionsConfig,
  manifestItemToManifest,
  type CompositionManifestItem,
} from "@plugins/plugin-meta/plugins/composition/core";
import type { PluginTreeData } from "@plugins/plugin-meta/plugins/plugin-tree/core";
import { getFacetsTreeCached } from "@plugins/plugin-meta/plugins/plugin-tree/server";
import type { PluginId } from "@plugins/framework/plugins/plugin-id/core";

/**
 * Which of `pluginIds` a composition's resolved closure includes — the server
 * twin of the web's `useCompositionIncludesEach`, over the same inputs (the
 * faceted plugin tree's classified edge graph and the `compositions` config)
 * and the same engine (`resolveComposition`, `extends` and the base
 * exclusions folded in). `unknown-composition`: no manifest answers to
 * `name` (renamed or removed). A tree that cannot be read throws.
 */
export type CompositionInclusionEach =
  | { kind: "unknown-composition" }
  | { kind: "ready"; included: ReadonlySet<PluginId> };

// The classified graph per tree identity: plugin-tree hands a new object when
// the tree changed, so a stale graph is never reused.
const graphs = new WeakMap<PluginTreeData, EdgeGraph>();
// One bundle per (graph, manifests, name): every caller asking about the same
// composition shares the closure walk.
let bundlesFor: { graph: EdgeGraph; items: CompositionManifestItem[] } | null =
  null;
const bundles = new Map<string, ReadonlySet<PluginId> | null>();

function graphOf(tree: PluginTreeData): EdgeGraph {
  const hit = graphs.get(tree);
  if (hit) return hit;
  const graph = classifyEdges(tree);
  graphs.set(tree, graph);
  return graph;
}

function bundleOf(
  graph: EdgeGraph,
  items: CompositionManifestItem[],
  name: string,
): ReadonlySet<PluginId> | null {
  if (bundlesFor?.graph !== graph || bundlesFor.items !== items) {
    bundles.clear();
    bundlesFor = { graph, items };
  }
  const cached = bundles.get(name);
  if (cached !== undefined) return cached;
  const registry = items.map(manifestItemToManifest);
  const manifest = registry.find((m) => m.name === name);
  const bundle = manifest
    ? resolveComposition(graph, flattenManifest(manifest, registry)).bundle
    : null;
  bundles.set(name, bundle);
  return bundle;
}

export async function compositionIncludesEach(
  name: string,
  pluginIds: readonly PluginId[],
): Promise<CompositionInclusionEach> {
  const graph = graphOf(await getFacetsTreeCached());
  const bundle = bundleOf(graph, getConfig(compositionsConfig).manifests, name);
  if (bundle === null) return { kind: "unknown-composition" };
  return {
    kind: "ready",
    included: new Set(pluginIds.filter((id) => bundle.has(id))),
  };
}
