import type { ReactNode } from "react";
import { useLive } from "@plugins/network/plugins/live/web";
import { matchResource } from "@plugins/network/plugins/live/plugins/live-state/web";
import { useEndpointMutation } from "@plugins/infra/plugins/endpoints/web";
import { Badge } from "@plugins/primitives/plugins/css/plugins/badge/web";
import { Line } from "@plugins/primitives/plugins/css/plugins/line/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { Button } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { Icon } from "@plugins/ui/plugins/icons/web";
import type { IconRef } from "@plugins/ui/plugins/icons/core";
import type { SiteFeedItemProps } from "@plugins/apps/plugins/deploy/plugins/site-feeds/plugins/editor/web";
import { siteFeedSyndications, type SiteFeedSyndicationRow } from "../../core";
import { retrySyndication } from "../../shared";
import { SyndicationTargets } from "../slots";
import { syndicationChip } from "../internal/chip";

/** Each target's label and icon, by id. */
function useTargetLabels(): ReadonlyMap<
  string,
  { label: string; icon: IconRef }
> {
  return new Map(
    SyndicationTargets.Target.useContributions().map(({ target }) => [
      target.id,
      { label: target.label, icon: target.icon },
    ]),
  );
}

/** The item's posts elsewhere as small chips in its list row: one per target. */
export function ItemSyndicationChips({ item }: SiteFeedItemProps): ReactNode {
  const rows = useLive(siteFeedSyndications, { where: { itemId: item.id } });
  const labels = useTargetLabels();
  return matchResource(rows, {
    loading: () => null,
    error: () => null,
    ready: (list: readonly SiteFeedSyndicationRow[]) => (
      <Line gap="xs">
        {list.map((r) => {
          const chip = syndicationChip(r, item.state === "published");
          const target = labels.get(r.targetId);
          return (
            <span key={r.targetId} title={r.error ?? undefined}>
              <Badge variant={chip.variant}>
                {target !== undefined && <Icon icon={target.icon} />}
                {chip.label}
              </Badge>
            </span>
          );
        })}
      </Line>
    ),
  });
}

/**
 * The opened item's posts elsewhere: each target's state, the last error in
 * words, and Retry — post, edit or remove again, whichever the item asks.
 */
export function ItemSyndications({ item }: SiteFeedItemProps): ReactNode {
  const rows = useLive(siteFeedSyndications, { where: { itemId: item.id } });
  const labels = useTargetLabels();
  const retry = useEndpointMutation(retrySyndication);
  return matchResource(rows, {
    ready: (list: readonly SiteFeedSyndicationRow[]) =>
      list.length === 0 ? null : (
        <Stack gap="xs">
          {list.map((r) => {
            const chip = syndicationChip(r, item.state === "published");
            const target = labels.get(r.targetId);
            return (
              <Stack key={r.targetId} gap="2xs">
                <Line gap="xs">
                  {target !== undefined && <Icon icon={target.icon} />}
                  <Text variant="label">{target?.label ?? r.targetId}</Text>
                  <Badge variant={chip.variant}>{chip.label}</Badge>
                  {r.state === "failed" && retry.kind === "available" && (
                    <Button
                      variant="outline"
                      onClick={async () => {
                        await retry.mutateAsync({
                          body: { itemId: item.id, targetId: r.targetId },
                        });
                      }}
                    >
                      Retry
                    </Button>
                  )}
                </Line>
                {r.error !== null && (
                  <Text
                    as="p"
                    variant="caption"
                    tone={r.state === "failed" ? "destructive" : "muted"}
                  >
                    {r.state === "pending" ? `Retrying: ${r.error}` : r.error}
                  </Text>
                )}
              </Stack>
            );
          })}
        </Stack>
      ),
  });
}
