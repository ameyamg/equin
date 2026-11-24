import { useEndpointMutation } from "@plugins/infra/plugins/endpoints/web";
import { useLive } from "@plugins/network/plugins/live/web";
import type {
  NotificationActionControlProps,
  NotificationActionKind,
} from "@plugins/shell/plugins/notifications/web";
import { Button } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import {
  AUTO_MERGE_ACTION_KIND,
  autoMergePayloadSchema,
  configAutoMerges,
  undoAutoMerge,
} from "../../core";
import { useAnnounceRefused } from "./undo-refused";

/**
 * Undo every merge the notification announced that can still be undone —
 * each back to its normal conflict (Keep / Accept / Merge in Settings →
 * Config). Drawn only while one can: once every merge is undone, superseded
 * by a later update or edited since, there is nothing left to undo here.
 */
function AutoMergeUndoControl({
  payload,
  label,
  done,
}: NotificationActionControlProps) {
  const { targets } = autoMergePayloadSchema.parse(payload);
  const merges = useLive(configAutoMerges);
  const announceRefused = useAnnounceRefused();
  const undo = useEndpointMutation(undoAutoMerge, {
    onSuccess: ({ refused }) => {
      announceRefused(refused);
      done();
    },
  });
  if (merges.status === "loading")
    return (
      <Button variant="ghost" disabled>
        {label}
      </Button>
    );
  if (merges.status === "error")
    return (
      <Text variant="caption" tone="destructive">
        Could not read the merges
      </Text>
    );
  const undoable = targets.filter((t) =>
    merges.data.some((m) => m.id === t.recordId && m.status === "current"),
  );
  if (undoable.length === 0) return null;
  return (
    <Button
      variant="ghost"
      loading={undo.isPending}
      onClick={() =>
        undo.mutate({
          body: {
            targets: undoable.map(({ storePath, scopeId }) => ({
              storePath,
              ...(scopeId ? { scopeId } : {}),
            })),
          },
        })
      }
    >
      {label}
    </Button>
  );
}

/** `config-auto-merge`: the update notification's Undo (written at boot). */
export const autoMergeUndoAction: NotificationActionKind = {
  kind: AUTO_MERGE_ACTION_KIND,
  label: "Undo",
  Control: AutoMergeUndoControl,
};
