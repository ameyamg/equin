import type { ReactElement } from "react";
import { useLive } from "@plugins/network/plugins/live/web";
import { foldResource } from "@plugins/network/plugins/live/plugins/live-state/web";
import {
  DataView,
  defineDataView,
} from "@plugins/primitives/plugins/data-view/web";
import { unownedActions, type UnownedAction } from "../../core";

// Marker scraped by codegen (data-views.generated.ts). Must live in web/**.
const UNOWNED_ACTIONS_VIEW = defineDataView("tasks.manage-grant.actions");

const NO_ROWS: UnownedAction[] = [];

/**
 * What was done to this task under a person's grant on another task (or this
 * one's own grant switched on / off), newest first: the action, the agent
 * that took it, the task whose grant allowed it.
 */
export function UnownedActionsSection({
  taskId,
}: {
  taskId: string;
}): ReactElement {
  const actions = useLive(unownedActions, { where: { taskId } });
  const rows = foldResource(actions, {
    loading: () => NO_ROWS,
    error: () => NO_ROWS,
    ready: (r) => r,
  });
  return (
    <DataView<UnownedAction>
      rows={rows}
      collection={unownedActions}
      rowKey={(r) => r.id}
      views={["list"]}
      storageKey={UNOWNED_ACTIONS_VIEW}
      readiness={actions}
      searchAccessor={(r) => r.action}
      emptyState={<>Nothing was done to it under a grant.</>}
    />
  );
}

/** The section shows only when there is something to list (or a failure). */
export function useHasUnownedActions({ taskId }: { taskId: string }): boolean {
  const actions = useLive(unownedActions, { where: { taskId }, limit: 1 });
  return foldResource(actions, {
    loading: () => false,
    error: () => true,
    ready: (r) => r.length > 0,
  });
}
