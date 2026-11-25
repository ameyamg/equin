import { existingTaskIds } from "@plugins/tasks/plugins/decisions/server";
import { taskDecisionsBlock } from "../../core";

/**
 * The `Editor.BlockReferenceCheck` of `<task-decisions>`: a document may keep,
 * move or delete one, never mint one (or re-point one) at a task that is not
 * there — nor one naming no task at all, which only the slash menu's picker
 * starts from.
 */
export async function checkTaskDecisionsReferences(
  datas: readonly unknown[],
): Promise<(string | null)[]> {
  const taskIds = datas.map((d) => taskDecisionsBlock.parse(d).taskId);
  const existing = await existingTaskIds(taskIds.filter((t) => t !== ""));
  return taskIds.map((t) =>
    t === ""
      ? '<task-decisions/> names no task — write `task="task-…"`, the task whose decisions it shows'
      : existing.has(t)
        ? null
        : `<task-decisions task="${t}"/> names no task that exists`,
  );
}
