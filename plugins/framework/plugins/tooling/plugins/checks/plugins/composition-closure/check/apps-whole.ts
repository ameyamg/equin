import type { PluginId } from "@plugins/framework/plugins/plugin-id/core";
import { parseEntryPattern } from "@plugins/plugin-meta/plugins/closure/plugins/entry-pattern/core";

/**
 * The subtree each app owns: the largest ancestor-or-self of the plugin that
 * declares it (its shell) holding no other app's declarer. Settings' shell
 * `apps.settings.shell` gives `apps.settings` (its panes are siblings of the
 * shell); a companion declared at `companions.menu-bar` stays there, since
 * `companions` also holds the browser extension.
 */
export function appRoots(declarers: readonly PluginId[]): PluginId[] {
  const within = (id: string, root: string) =>
    id === root || id.startsWith(`${root}.`);
  return declarers.map((own) => {
    let root: string = own;
    for (;;) {
      const dot = root.lastIndexOf(".");
      if (dot < 0) break;
      const parent = root.slice(0, dot);
      if (declarers.some((d) => d !== own && within(d, parent))) break;
      root = parent;
    }
    return root as PluginId;
  });
}

/**
 * A profile — a variant of one app — adds every other app WHOLE: a positive
 * entry inside an app's subtree is that app's `<root>.**`, never a
 * hand-picked plugin of it, which would drift from the app it belongs to (a
 * pane the app gains would not reach the profile). An app with only some of
 * its panes is spelled the same way, whole less negatives on the rest
 * (`apps.settings.**` + `!apps.settings.appearance.**`). The one exception is
 * a leaf kept under one of the row's own negatives (a capability id other code
 * grants, kept while its feature leaves: the engine's opt-out).
 *
 * Returns the offending entries, each with the app it reaches into.
 */
export function partialAppEntries(
  entryPoints: readonly string[],
  roots: readonly PluginId[],
): { entry: string; app: PluginId }[] {
  const parsed = entryPoints.map(parseEntryPattern);
  const negated = parsed.flatMap((p) =>
    p.kind === "id" && p.negate && p.subtree ? [p.base] : [],
  );
  const out: { entry: string; app: PluginId }[] = [];
  for (const p of parsed) {
    if (p.kind !== "id" || p.negate) continue;
    const app = roots.find((r) => p.base === r || p.base.startsWith(`${r}.`));
    if (app === undefined) continue;
    if (p.base === app && p.subtree) continue;
    if (negated.some((b) => p.base.startsWith(`${b}.`))) continue;
    out.push({ entry: p.raw, app });
  }
  return out;
}
