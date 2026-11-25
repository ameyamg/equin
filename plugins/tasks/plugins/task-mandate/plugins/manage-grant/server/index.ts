import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { Trigger } from "@plugins/infra/plugins/events/server";
import { ConfigV2 } from "@plugins/config_v2/server";
import { IdKinds } from "@plugins/ids/server";
import { taskStatusChanged } from "@plugins/tasks/plugins/tasks-core/server";
import { manageGrantPromptsConfig, unownedActionIdKind } from "../core";
import { manageGrantOverlay, manageUnownedCapability } from "./internal/grant";
import {
  clearGrantOnSettleJob,
  clearGrantSweepWarmup,
} from "./internal/clear-on-settle";
import {
  taskManageGrantsServed,
  unownedActionsServed,
} from "./internal/resource";

export {
  clearTaskManageGrant,
  GrantRefused,
  grantHeld,
  recordUnownedAction,
  setTaskManageGrant,
} from "./internal/grant";
export type { UnownedActionRecord } from "./internal/grant";

export default {
  description:
    "A person's grant on one task — 'may manage tasks it doesn't own': the tasks_ext_manage_grant row (on = a row), joined to the mandate of that task's OWN conversation only through a MandateOverlay (never a side chat, a worker or a subtask) while the task is not done or dropped, with its `## Mandate` line (an editable prompt, the Manage grant instructions config); removed when the task settles (a job on tasks.statusChanged, plus a boot sweep); setTaskManageGrant / clearTaskManageGrant (each recorded, and announced as tasks.mandateChanged so the running agent is told), grantHeld, and the task_unowned_actions audit every action taken under a grant is recorded in (recordUnownedAction), served as tasks.unowned-actions.",
  contributions: [
    ConfigV2.Register({ descriptor: manageGrantPromptsConfig }),
    ...taskManageGrantsServed.declare,
    ...unownedActionsServed.declare,
    manageGrantOverlay,
    manageUnownedCapability,
    IdKinds.Kind({ kind: unownedActionIdKind }),
    Trigger({
      on: taskStatusChanged,
      do: clearGrantOnSettleJob,
      with: {},
      oneShot: false,
    }),
  ],
  register: [clearGrantOnSettleJob, clearGrantSweepWarmup],
} satisfies ServerPluginDefinition;
