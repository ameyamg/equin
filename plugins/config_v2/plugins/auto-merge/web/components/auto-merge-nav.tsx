import { useMemo, type ReactNode } from "react";
import { useLive } from "@plugins/network/plugins/live/web";
import {
  mapResource,
  ResourceErrorInline,
  type ResourceResult,
} from "@plugins/network/plugins/live/plugins/live-state/web";
import {
  useShowConfigNavView,
  type ConfigNavFieldRead,
} from "@plugins/config_v2/plugins/settings/web";
import { useAudience } from "@plugins/audience/web";
import { reachesAudience } from "@plugins/audience/core";
import { DeveloperMark } from "@plugins/audience/plugins/developer-mark/web";
import { Button, cn } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { Fill } from "@plugins/primitives/plugins/css/plugins/fill/web";
import { rigidClass } from "@plugins/primitives/plugins/css/plugins/rigid/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
import { configAutoMerges, type AutoMergeSummary } from "../../core";

/** The authored nav view listing the auto-merged configs (`config_v2.settings.nav`). */
export const AUTO_MERGED_VIEW = "auto-merged";

const mergeIcon = symbol("merge");

/** A merge still in force: neither undone nor superseded by a later update. */
function inForce(m: AutoMergeSummary): boolean {
  return m.status === "current" || m.status === "edited";
}

function storePathsInForce(
  merges: readonly AutoMergeSummary[],
): ReadonlySet<string> {
  return new Set(merges.filter(inForce).map((m) => m.path));
}

/**
 * The config nav's `autoMerged` field: the configs whose last update merged
 * automatically, the merge still in force (any scope).
 */
function useAutoMergedStorePaths(): ResourceResult<ReadonlySet<string>> {
  const merges = useLive(configAutoMerges);
  return useMemo(() => mapResource(merges, storePathsInForce), [merges]);
}

/** Reads the nav's `autoMerged` field (`ConfigNavSlots.Field`). */
export function AutoMergedNavField({
  children,
}: {
  children: (read: ConfigNavFieldRead) => ReactNode;
}) {
  return children(useAutoMergedStorePaths());
}

/**
 * Pinned above the config nav, for a developer: how many configs the updates
 * merged automatically that nobody reviewed yet, and Review — the nav's
 * Auto-merged view. Nothing for anyone else, nothing when every merge is
 * reviewed, nothing while either read is not known yet.
 */
export function AutoMergeNavNotice() {
  const audience = useAudience();
  const merges = useLive(configAutoMerges);
  const showView = useShowConfigNavView();
  if (audience.status === "loading" || merges.status === "loading") return null;
  if (audience.status === "error") throw audience.error;
  if (!reachesAudience("developer", audience.data)) return null;
  if (merges.status === "error")
    return (
      <ResourceErrorInline
        variant="inline"
        subject="the automatic config merges"
        error={merges.error}
        refetch={merges.refetch}
      />
    );
  const count = merges.data.filter(
    (m) => inForce(m) && m.acknowledgedAt === undefined,
  ).length;
  if (count === 0) return null;
  return (
    <Text
      as="div"
      variant="body"
      // eslint-disable-next-line rail/no-adhoc-band -- the same strip as debug/config-orphans' StrandedConfigNotice in this slot; moves with it (task-1794239361-kagy27)
      className="border-b border-info/30 bg-info/10 px-md py-sm text-info"
    >
      <Stack direction="row" gap="sm" align="center" wrap>
        <Icon icon={mergeIcon} className={cn("size-4", rigidClass())} />
        <Fill as="span">
          {count === 1
            ? "1 config was auto-merged by an update, not reviewed yet"
            : `${count} configs were auto-merged by updates, not reviewed yet`}{" "}
          <DeveloperMark />
        </Fill>
        {showView !== null && (
          <Button
            variant="ghost"
            className="bg-info/20 hover:bg-info/30"
            onClick={() => showView(AUTO_MERGED_VIEW)}
          >
            Review
          </Button>
        )}
      </Stack>
    </Text>
  );
}
