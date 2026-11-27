import type { ReactElement } from "react";
import {
  useLive,
  type LiveListResult,
} from "@plugins/network/plugins/live/web";
import { ResourceErrorInline } from "@plugins/network/plugins/live/plugins/live-state/web";
import {
  historyVersion,
  historyVersions,
  type VersionRow,
} from "@plugins/history/plugins/engine/core";
import { IconButton } from "@plugins/primitives/plugins/icon-button/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import {
  DECISION_HISTORY_SOURCE,
  DecisionSnapshotSchema,
  type DecisionSnapshot,
} from "../../core";

const chevronLeftIcon = symbol("chevron-left");
const chevronRightIcon = symbol("chevron-right");

/** How many of a decision's latest versions the navigator steps through. */
const VERSIONS_SHOWN = 100;

/**
 * A decision's versions, newest first (`history/engine`'s timeline — every
 * edit of a decision is its own version, the newest one what it says now).
 */
export function useDecisionVersions(
  decisionId: string,
): LiveListResult<VersionRow> {
  return useLive(historyVersions, {
    where: { sourceId: DECISION_HISTORY_SOURCE, entityId: decisionId },
    orderBy: [["createdAt", "desc"]],
    limit: VERSIONS_SHOWN,
  });
}

/**
 * `‹ n / N ›`: steps through a decision's versions, oldest (1) to the one it
 * says now (N). Drawn only once the decision has been edited (two versions or
 * more); while the timeline loads it is left out, as an addition to the card.
 * `viewing` is the past version shown, `null` for the current one.
 */
export function VersionNav({
  versions,
  viewing,
  onView,
}: {
  versions: LiveListResult<VersionRow>;
  viewing: string | null;
  onView: (versionId: string | null) => void;
}): ReactElement | null {
  if (versions.status === "loading") return null;
  if (versions.status === "error")
    return (
      <ResourceErrorInline
        variant="inline"
        subject="its earlier versions"
        error={versions.error}
        refetch={versions.refetch}
      />
    );
  const rows = versions.data; // newest first
  if (rows.length < 2) return null;
  const total = rows.length;
  // Index into `rows`: 0 is the current version.
  const at = viewing === null ? 0 : rows.findIndex((v) => v.id === viewing);
  const index = at < 0 ? 0 : at;
  const go = (i: number) => {
    const row = rows[i];
    // The arrows are disabled at both ends: a step out of range is a bug.
    if (row === undefined)
      throw new Error(`decision versions: no version at ${i} of ${total}`);
    onView(i === 0 ? null : row.id);
  };
  return (
    <Stack direction="row" gap="2xs" align="center">
      <IconButton
        icon={chevronLeftIcon}
        label="Earlier version"
        disabled={index === total - 1}
        onClick={() => go(index + 1)}
      />
      <Text variant="caption" tone="muted">
        {`${total - index} / ${total}`}
      </Text>
      <IconButton
        icon={chevronRightIcon}
        label="Later version"
        disabled={index === 0}
        onClick={() => go(index - 1)}
      />
    </Stack>
  );
}

/** One past version's snapshot, read live and parsed with the record's schema. */
export function PastVersion({
  decisionId,
  versionId,
  children,
}: {
  decisionId: string;
  versionId: string;
  children: (snapshot: DecisionSnapshot, createdAt: Date) => ReactElement;
}): ReactElement {
  const version = useLive(historyVersion, {
    sourceId: DECISION_HISTORY_SOURCE,
    entityId: decisionId,
    versionId,
  });
  if (version.status === "loading") return <Loading variant="rows" count={3} />;
  if (version.status === "error")
    return (
      <ResourceErrorInline
        variant="inline"
        subject="this version"
        error={version.error}
        refetch={version.refetch}
      />
    );
  return children(
    DecisionSnapshotSchema.parse(version.data.snapshot),
    version.data.createdAt,
  );
}

/**
 * When a past version was replaced: the time of the version after it (the
 * timeline is newest first). The navigator only offers versions of the
 * timeline it read, so one missing from it, or the current one, is a bug.
 */
export function versionEnd(
  rows: readonly VersionRow[],
  versionId: string,
): Date {
  const at = rows.findIndex((v) => v.id === versionId);
  const next = at > 0 ? rows[at - 1] : undefined;
  if (next === undefined)
    throw new Error(
      `decision versions: ${versionId} is not a past version of the timeline`,
    );
  return next.createdAt;
}
