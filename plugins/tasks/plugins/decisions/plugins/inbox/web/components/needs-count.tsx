import type { ReactElement } from "react";
import { useLive } from "@plugins/network/plugins/live/web";
import { foldResource } from "@plugins/network/plugins/live/plugins/live-state/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { decisionsList } from "@plugins/tasks/plugins/decisions/core";

/**
 * The Decisions entry's trailing count: how many decisions need the user —
 * one grouping of the derived `tab`, the only attention signal (no bell).
 * Nothing while unknown or zero; a failed read says so instead of a count.
 */
export function NeedsYouCount(): ReactElement | null {
  const groups = useLive(decisionsList, { groupBy: "tab" });
  return foldResource(groups, {
    loading: () => null,
    error: (error) => (
      <Text variant="count" tone="destructive" title={error.message}>
        !
      </Text>
    ),
    ready: (data) => {
      const needs = data.find((g) => g.value === "needs")?.count ?? 0;
      return needs === 0 ? null : (
        <Text variant="count" tone="muted">
          {needs}
        </Text>
      );
    },
  });
}
