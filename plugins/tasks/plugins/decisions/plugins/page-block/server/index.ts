import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { Editor } from "@plugins/page/plugins/editor/server";
import { taskDecisionsBlock } from "../core";
import { projectTaskDecisionsBlocks } from "./internal/projection";
import { checkTaskDecisionsReferences } from "./internal/reference-check";

export default {
  description:
    'The <task-decisions task="task-…"/> page block, server half: registers its data schema at the write boundary; projects it per reader for read_page (the task\'s title, then every decision in full — label, state, where it stands, question, quoted body, options, thread, outcome — as <decision> lines to any other agent, and the one-line own="N open, M closed" stub to the agent whose task it is; missing="task deleted" when the task is gone), both read-only and discarded on parse, so the block round-trips through edit_page; and refuses a markdown apply minting or re-pointing one at a task that does not exist.',
  contributions: [
    Editor.BlockData(taskDecisionsBlock),
    Editor.BlockProjection({
      type: taskDecisionsBlock.type,
      project: projectTaskDecisionsBlocks,
    }),
    Editor.BlockReferenceCheck({
      type: taskDecisionsBlock.type,
      check: checkTaskDecisionsReferences,
    }),
  ],
} satisfies ServerPluginDefinition;
