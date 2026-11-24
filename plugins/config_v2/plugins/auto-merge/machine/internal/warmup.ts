import { readAutoMerge } from "@plugins/config_v2/server";
import { defineWarmup } from "@plugins/infra/plugins/warmup/server";
import { listAutoMerges } from "@plugins/config_v2/plugins/auto-merge/server";
import { autoMergePlaceJob } from "./place";

/**
 * Queue the placement of every merge record whose placement is pending — at
 * boot, after the registry's sweep (in `onReadyBlocking`) merged. Undone and
 * superseded ones too: the job settles them `skipped`, so none is left
 * showing "placing" for good. A record
 * whose job already ran settled it (`decided` / `skipped`), so it is never
 * asked twice; one queued but not run yet coalesces on its record id.
 */
export async function enqueuePendingPlacements(): Promise<void> {
  for (const m of await listAutoMerges()) {
    const state = await readAutoMerge(m.path, m.scopeId);
    if (state?.record.id !== m.id) continue;
    if (state.record.placement.status !== "pending") continue;
    await autoMergePlaceJob.enqueue({
      storePath: m.path,
      ...(m.scopeId ? { scopeId: m.scopeId } : {}),
      recordId: m.id,
    });
  }
}

export const autoMergePlaceWarmup = defineWarmup({
  name: "config-auto-merge.place",
  description:
    "Queues placing the items an update added to your customized lists.",
  scope: "worktree",
  run: enqueuePendingPlacements,
});
