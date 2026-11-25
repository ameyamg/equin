import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Editor } from "@plugins/page/plugins/editor/web";
import { taskDecisionsBlock } from "../core";
import { TaskDecisionsBlock } from "./components/task-decisions-block";

export default {
  description:
    'The <task-decisions task="task-…"/> page block: one task\'s decisions on a page, drawn as the conversation tray draws them (TaskDecisionsPanel, shown even while none is open) and answered in place with the inbox\'s drafts and Submit. Inserted by /decisions (a picker over the tasks, the latest edited first), or written by an agent with edit_page; a deleted task reads "task deleted".',
  contributions: [
    Editor.Block({
      id: taskDecisionsBlock.type,
      match: taskDecisionsBlock.type,
      block: taskDecisionsBlock,
      component: TaskDecisionsBlock,
      caret: "editor",
    }),
  ],
} satisfies PluginDefinition;
