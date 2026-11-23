import { useLive } from "@plugins/network/plugins/live/web";
import { ResourceErrorInline } from "@plugins/network/plugins/live/plugins/live-state/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import { Switch } from "@plugins/primitives/plugins/css/plugins/switch/web";
import { Badge } from "@plugins/primitives/plugins/css/plugins/badge/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { useFetchEndpoint } from "@plugins/infra/plugins/endpoints/web";
import { pageOrigin } from "@plugins/infra/plugins/request-origin/core";
import { useToast } from "@plugins/shell/plugins/notifications/web";
import { useTask } from "@plugins/tasks/web";
import { isSettled } from "@plugins/tasks/plugins/tasks-core/core";
import {
  deleteTaskManageGrant,
  putTaskManageGrant,
  taskManageGrants,
} from "../../core";

/**
 * The task's "May manage tasks it doesn't own" grant, beside its Mandate: a
 * switch only a person flips. While on, a warning chip says so at a glance.
 * Read-only on a done or dropped task (the grant ended with it) and on a page
 * an automated session drives (the server refuses it anyway).
 */
export function TaskManageGrantControl({ taskId }: { taskId: string }) {
  const grant = useLive(taskManageGrants, { id: taskId });
  const task = useTask(taskId);
  const fetchEndpoint = useFetchEndpoint();
  const toast = useToast();

  if (grant.status === "loading" || task.status === "loading")
    return <Loading variant="block" className="h-5 w-24" />;
  if (grant.status === "error")
    return (
      <ResourceErrorInline
        variant="inline"
        subject="the grant"
        error={grant.error}
        refetch={grant.refetch}
      />
    );
  if (task.status === "error")
    return (
      <ResourceErrorInline
        variant="inline"
        subject="the task"
        error={task.error}
        refetch={task.refetch}
      />
    );

  const on = grant.found;
  const settled = task.data != null && isSettled(task.data.status);
  const automated = pageOrigin().kind === "agent";

  const onChange = (next: boolean) => {
    const call = next
      ? fetchEndpoint(putTaskManageGrant, { taskId })
      : fetchEndpoint(deleteTaskManageGrant, { taskId });
    call.catch((err: unknown) => {
      toast({
        type: "task",
        category: "other",
        title: next ? "Could not grant it" : "Could not remove the grant",
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    });
  };

  return (
    <Stack direction="row" align="center" gap="sm">
      <Switch
        checked={on}
        disabled={(settled && !on) || automated}
        aria-label="May manage tasks it doesn't own"
        onCheckedChange={onChange}
      />
      {on ? (
        <Badge variant="warning">May manage tasks it doesn’t own</Badge>
      ) : (
        <Text as="span" variant="caption" tone="muted">
          May manage tasks it doesn’t own
        </Text>
      )}
    </Stack>
  );
}
