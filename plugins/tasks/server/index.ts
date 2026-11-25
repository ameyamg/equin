import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { ConfigV2 } from "@plugins/config_v2/server";
import { handleList } from "./internal/handle-list";
import { handleCreate } from "./internal/handle-create";
import { handleCreateChain } from "./internal/handle-create-chain";
import { handleClearAutoStart } from "./internal/handle-clear-auto-start";
import { handleSetAutoStart } from "./internal/handle-set-auto-start";
import { handleGet } from "./internal/handle-get";
import { handleUpdate } from "./internal/handle-update";
import { handleMove } from "./internal/handle-move";
import {
  handleAddDependency,
  handleRemoveDependency,
} from "./internal/handle-dependencies";
import { handleInsertBetween } from "./internal/handle-insert-between";
import { handleDepsMove } from "./internal/handle-deps-move";
import {
  dropTaskTool,
  editTaskTool,
  tasksManageCapability,
} from "./internal/manage-tools";
import { openSidequestsGate } from "./internal/open-sidequests-gate";
import {
  handleDeleteManageGrant,
  handlePutManageGrant,
} from "./internal/handle-manage-grant";
import {
  deleteTaskManageGrant,
  putTaskManageGrant,
} from "@plugins/tasks/plugins/task-mandate/plugins/manage-grant/core";
import {
  listTasks,
  createTask,
  createTaskChain,
  insertTaskBetween,
  getTask,
  updateTask,
  moveTask,
  addTaskDependency,
  removeTaskDependency,
  moveTaskInDepsTree,
  taskFilingPromptsConfig,
} from "../core";
import {
  setTaskAutoStart,
  clearTaskAutoStart,
} from "@plugins/tasks/plugins/auto-start/core";

export { armTaskAutoStart } from "./internal/arm-auto-start";

export default {
  description:
    "Nested tasks with attempts linking to conversations: the task CRUD, chain, dependency and auto-start routes, and the edit_task / drop_task MCP tools (scoped to the tasks the caller OWNS — what it filed, a supervisor's tree; starting and retracking need the tasks.manage grant; edit_task hands a task to a supervisor's backlog; a person's grant on a task — switched only from a browser, never for a task an agent owns — lifts the ownership refusal for that task's own conversation, each such action recorded on the task it changes), the open-sidequests exit gate (exit_clean refused while a sidequest the caller filed still waits), portable (arming a task wakes the launcher through the tasks.autoStartArmed trigger event). Launching, the repo info, the add_task MCP tool and the auto-start catch-up are the machine half's. Registers the Task filing instructions config (the tasks.file Mandate line and the grant clauses add_task describes it with).",
  contributions: [
    ConfigV2.Register({ descriptor: taskFilingPromptsConfig }),
    tasksManageCapability,
    openSidequestsGate,
  ],
  register: [editTaskTool, dropTaskTool],
  httpRoutes: {
    [listTasks.route]: handleList,
    [createTask.route]: handleCreate,
    [createTaskChain.route]: handleCreateChain,
    [insertTaskBetween.route]: handleInsertBetween,
    [getTask.route]: handleGet,
    [updateTask.route]: handleUpdate,
    [moveTask.route]: handleMove,
    [setTaskAutoStart.route]: handleSetAutoStart,
    [clearTaskAutoStart.route]: handleClearAutoStart,
    [addTaskDependency.route]: handleAddDependency,
    [removeTaskDependency.route]: handleRemoveDependency,
    [moveTaskInDepsTree.route]: handleDepsMove,
    [putTaskManageGrant.route]: handlePutManageGrant,
    [deleteTaskManageGrant.route]: handleDeleteManageGrant,
  },
  // The `pushes` ledger used to be filled from here, by a `tasks.push-ingest`
  // job hung off the `git.refAdvanced` trigger plus a host-scoped boot warm-up.
  // Both are gone: the ledger is a projection of `main` owned by `tasks-core`,
  // refreshed by an in-process ref reaction and guaranteed on read. See
  // `research/2026-08-18-global-push-ledger-git-projection.md`.
} satisfies ServerPluginDefinition;
