import { useEndpointMutation } from "@plugins/infra/plugins/endpoints/web";
import { useLive } from "@plugins/network/plugins/live/web";
import { ResourceErrorInline } from "@plugins/network/plugins/live/plugins/live-state/web";
import type { ConfigDocumentBannerProps } from "@plugins/config_v2/plugins/settings/web";
import { Button, cn } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { Fill } from "@plugins/primitives/plugins/css/plugins/fill/web";
import { rigidClass } from "@plugins/primitives/plugins/css/plugins/rigid/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
import {
  acknowledgeAutoMerge,
  configAutoMerge,
  undoAutoMerge,
} from "../../core";
import { useAnnounceRefused } from "./undo-refused";

const mergeIcon = symbol("merge");
const ACTION_CLASS = cn("bg-info/20 hover:bg-info/30");

function shown(value: unknown): string {
  const text = JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/**
 * Above a config the last update merged automatically: "Updated with the new
 * defaults; your changes kept", how many notes the merge left, each field it
 * dropped (the update removed it; the user's value no longer applies), Undo —
 * the normal conflict back — and Dismiss. Nothing once dismissed, undone or
 * superseded by a later update; Undo is off once the user edited the config
 * since (it would discard that edit).
 */
export function AutoMergeBanner({
  storePath,
  scopeId,
}: ConfigDocumentBannerProps) {
  const merge = useLive(configAutoMerge, { path: storePath, scopeId });
  const announceRefused = useAnnounceRefused();
  const undo = useEndpointMutation(undoAutoMerge, {
    onSuccess: ({ refused }) => announceRefused(refused),
  });
  const ack = useEndpointMutation(acknowledgeAutoMerge);
  if (merge.status === "loading") return null;
  if (merge.status === "error")
    return (
      <ResourceErrorInline
        variant="inline"
        subject="this config's automatic merge"
        error={merge.error}
        refetch={merge.refetch}
      />
    );
  const state = merge.data;
  if (
    state === null ||
    state.status === "superseded" ||
    state.status === "undone" ||
    state.record.acknowledgedAt !== undefined
  )
    return null;
  const { record } = state;
  const notes = record.decisions.length;
  const removed = record.decisions.flatMap((d) =>
    d.kind === "removed-dropped" ? [d] : [],
  );
  const target = { storePath, ...(scopeId ? { scopeId } : {}) };
  return (
    <Text
      as="div"
      variant="body"
      className="rounded-md border border-info/30 bg-info/10 px-md py-sm text-info"
    >
      <Stack gap="xs">
        <Stack direction="row" gap="sm" align="center" wrap>
          <Icon icon={mergeIcon} className={cn("size-4", rigidClass())} />
          <Fill as="span">
            Updated with the new defaults; your changes kept
            {notes > 0 && ` · ${notes} note${notes === 1 ? "" : "s"}`}
          </Fill>
          <Button
            variant="ghost"
            className={ACTION_CLASS}
            loading={undo.isPending}
            disabled={state.status === "edited"}
            onClick={() => undo.mutate({ body: { targets: [target] } })}
          >
            Undo
          </Button>
          <Button
            variant="ghost"
            className={ACTION_CLASS}
            loading={ack.isPending}
            onClick={() =>
              ack.mutate({ body: { ...target, recordId: record.id } })
            }
          >
            Dismiss
          </Button>
        </Stack>
        {state.status === "edited" && (
          <Text variant="caption" tone="muted">
            You changed this config since the update, so Undo would discard that
            change.
          </Text>
        )}
        {removed.map((d) => (
          <Text key={d.path.join(".")} variant="caption" tone="muted">
            {d.path.join(".")} was removed; your value {shown(d.yours)} no
            longer applies.
          </Text>
        ))}
      </Stack>
    </Text>
  );
}
