import { defineWarmup } from "@plugins/infra/plugins/warmup/server";
import { recordNotification } from "@plugins/shell/plugins/notifications/server";
import { stampAutoMergeByPath } from "@plugins/config_v2/server";
import { systemOrigin } from "@plugins/infra/plugins/request-origin/core";
import { hash53 } from "@plugins/packages/plugins/string-hash/core";
import { symbol } from "@plugins/ui/plugins/icons/core";
import {
  AUTO_MERGE_ACTION_KIND,
  AUTO_MERGE_NOTIFICATION_TYPE,
  autoMergeDescription,
  configDisplayName,
  type AutoMergePayload,
} from "../../core";
import { listAutoMerges } from "./list";

const NOTIFY_WRITER = systemOrigin("config-v2.auto-merge.notify");

/**
 * Announce the merges an update applied, ONE notification for the batch: every
 * record still current that no notification announced yet (`notifiedAt`) —
 * whatever wrote it, the boot sweep today, a config generation's derivation
 * later. Each record is stamped notified once the row is written, and the
 * row's dedupe key is the batch's record ids, so a run interrupted between the
 * two re-finds the same batch and coalesces into the same row.
 */
export async function notifyAutoMerges(): Promise<void> {
  const pending = (await listAutoMerges()).filter(
    (m) =>
      m.status === "current" &&
      m.notifiedAt === undefined &&
      m.acknowledgedAt === undefined,
  );
  if (pending.length === 0) return;
  const payload: AutoMergePayload = {
    targets: pending.map((m) => ({
      storePath: m.path,
      ...(m.scopeId ? { scopeId: m.scopeId } : {}),
      recordId: m.id,
    })),
  };
  const ids = pending
    .map((m) => m.id)
    .sort()
    .join(",");
  await recordNotification({
    type: AUTO_MERGE_NOTIFICATION_TYPE,
    category: "updates",
    variant: "info",
    audience: "user",
    icon: symbol("merge"),
    title:
      pending.length === 1
        ? "A setting you changed got new defaults"
        : `${pending.length} settings you changed got new defaults`,
    description: autoMergeDescription(
      pending.map((m) => configDisplayName(m.path, m.scopeId)),
    ),
    dedupeKey: `${AUTO_MERGE_NOTIFICATION_TYPE}:${hash53(ids).toString(36)}`,
    action: { kind: AUTO_MERGE_ACTION_KIND, payload },
  });
  for (const m of pending) {
    await stampAutoMergeByPath(m.path, m.id, "notifiedAt", {
      writer: NOTIFY_WRITER,
      scopeId: m.scopeId,
    });
  }
}

/**
 * The announcement, as a declared warm-up: it only writes a notification, so
 * nothing waits on it, and the drain runs after every `onReady` — the
 * registry's boot sweep (in `onReadyBlocking`) has merged by then. `worktree`
 * scope: the user layer it reads is this namespace's.
 */
export const autoMergeNotifyWarmup = defineWarmup({
  name: "config-auto-merge.notify",
  description:
    "Tells you which of your changed settings were merged with an update's new defaults.",
  scope: "worktree",
  run: notifyAutoMerges,
});
