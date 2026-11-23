import { useTask } from "@plugins/tasks/web";
import { TaskLink } from "@plugins/tasks/plugins/task-detail/web";

/**
 * "from <task>": the ancestor an inherited mandate comes from, linked to its
 * detail. Its raw id stands in until (or unless) the task reads.
 */
export function MandateSource({ sourceTaskId }: { sourceTaskId: string }) {
  const source = useTask(sourceTaskId);
  const title =
    source.status === "ready" && source.data ? source.data.title : null;
  return (
    <TaskLink
      taskId={sourceTaskId}
      title={title ?? sourceTaskId}
      prefix="from"
      variant="caption"
      tone="muted"
    />
  );
}
