import { useMemo } from "react";
import {
  FieldPresentation,
  useLive,
  type LiveFieldOption,
  type LiveFieldOptionsRead,
} from "@plugins/network/plugins/live/web";
import {
  foldResource,
  mapResource,
} from "@plugins/network/plugins/live/plugins/live-state/web";
import { taskRows } from "@plugins/tasks/plugins/tasks-core/core";
import { decisionsList } from "@plugins/tasks/plugins/decisions/core";

/** The most agents the inbox labels — a grouping's own bound (`LIST_MAX`). */
const AGENTS_LABELLED = 100;

/**
 * The `taskId` field's options: every task holding decisions, labelled by its
 * current title — so the inbox groups by the TASK (two agents with one title
 * are two groups) and each group still reads as its agent. Loading until the
 * titles are known — never raw-id sections that relabel later.
 */
function useDecisionTaskOptions(): LiveFieldOptionsRead {
  const groups = useLive(decisionsList, {
    groupBy: "taskId",
    limit: AGENTS_LABELLED,
  });
  const ids = useMemo(
    () =>
      foldResource(groups, {
        loading: () => null,
        error: () => null,
        ready: (data) =>
          data
            .map((g) => g.value)
            .filter((v) => v !== null)
            .map((v): string => v)
            .sort(),
      }),
    [groups],
  );
  // Read once the tasks are known; until then the grouping's own state.
  const tasks = useLive(taskRows, { ids: ids ?? [] });
  return useMemo(
    () =>
      ids === null
        ? mapResource(groups, (): readonly LiveFieldOption[] => [])
        : mapResource(tasks, (rows): readonly LiveFieldOption[] =>
            rows.map((t) => ({ value: t.id, label: t.title })),
          ),
    [ids, groups, tasks],
  );
}

/** The inbox's grouping field, the decision's task, presented by its title. */
export const decisionTaskPresentation = FieldPresentation.Register({
  owner: decisionsList,
  fields: { taskId: { useOptions: useDecisionTaskOptions } },
});
