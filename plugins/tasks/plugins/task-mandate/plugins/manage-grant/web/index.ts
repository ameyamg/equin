import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { IdKinds } from "@plugins/ids/web";
import { TaskDetailSlots } from "@plugins/tasks/plugins/task-detail/web";
import { unownedActionIdKind } from "../core";
import {
  UnownedActionsSection,
  useHasUnownedActions,
} from "./components/unowned-actions";

export { TaskManageGrantControl } from "./components/grant-control";

export default {
  description:
    "The task header's 'May manage tasks it doesn't own' switch (TaskManageGrantControl, beside the Mandate: a person's grant to that task's own conversation, a warning chip while on, read-only on a done or dropped task and on an agent-driven page), and the task detail's 'Done under a grant' section: a DataView of the actions taken on the task under a grant, and the grant's own switches.",
  contributions: [
    IdKinds.Kind({ kind: unownedActionIdKind }),
    TaskDetailSlots.Section({
      id: "unowned-actions",
      label: "Done under a grant",
      component: UnownedActionsSection,
      useAvailable: useHasUnownedActions,
      useDefaultOpen: () => true,
    }),
  ],
} satisfies PluginDefinition;
