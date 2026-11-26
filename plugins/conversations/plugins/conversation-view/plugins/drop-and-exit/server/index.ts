import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";

export { settleTaskOnExit } from "./internal/settle-task-on-exit";
export type { ExitSettled } from "./internal/settle-task-on-exit";

export default {
  description:
    "The one exit-settlement policy every conversation-close path shares (settleTaskOnExit): the Drop & Close endpoint (its machine half) drops a task whose work has not landed; the agent-driven exit_clean finalize never drops, and delivers an attempt with nothing to land so the task reads done.",
} satisfies ServerPluginDefinition;
