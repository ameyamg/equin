import { inArray } from "drizzle-orm";
import { db } from "@plugins/database/server";
import { declaredApps } from "@plugins/apps-core/server";
import { defineWarmup } from "@plugins/infra/plugins/warmup/server";
import { ensureTagPath } from "@plugins/tag-tree/plugins/engine/server";
import { servedAppCategoryTree } from "./resources";
import { _appCategories } from "./tables";

/**
 * Files every app this backend declares that has no assignment row yet under
 * the default path its `defineApp({ category })` names (creating the missing
 * tags), or as uncategorised when it names none. An app with a row is never
 * touched again: what the user made of it — a move, a rename, a deleted tag —
 * stays. Runs every boot, so a newly installed app is filed on the next one.
 *
 * A warm-up, not a boot barrier: the assignments and the tree are live, so
 * an app's category appears when it lands. `worktree` scope: a fork inherits
 * main's rows and files only the apps it adds.
 */
export const fileNewAppsWarmup = defineWarmup({
  name: "app-category.file-new-apps",
  description:
    "Files each newly installed app under the default category its defineApp declares.",
  scope: "worktree",
  run: () => fileNewApps(),
});

export async function fileNewApps(): Promise<void> {
  const apps = declaredApps().map((d) => d.app);
  if (apps.length === 0) return;
  const filed = new Set(
    (
      await db
        .select({ id: _appCategories.id })
        .from(_appCategories)
        .where(
          inArray(
            _appCategories.id,
            apps.map((a) => a.id),
          ),
        )
    ).map((r) => r.id),
  );
  for (const app of apps) {
    if (filed.has(app.id)) continue;
    const tagId =
      app.category === undefined
        ? null
        : await ensureTagPath(servedAppCategoryTree, app.category);
    // A racing boot may have filed it meanwhile: its row wins.
    await db
      .insert(_appCategories)
      .values({ id: app.id, tagId })
      .onConflictDoNothing({ target: _appCategories.id });
  }
}
