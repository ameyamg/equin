import { z } from "zod";
import { defineBlock } from "@plugins/page/plugins/editor/core";
import { taskIdKind } from "@plugins/tasks/plugins/task-ids/core";
import { symbol } from "@plugins/ui/plugins/icons/core";

export const TASK_DECISIONS_BLOCK_ICON = symbol("inbox");

/**
 * `<task-decisions task="task-…"/>` — a page block embedding one task's
 * decisions. The page stores the task and nothing else: what the decisions
 * say lives in the decisions record, drawn live by the editor and projected
 * per reader by `read_page` (this plugin's server).
 *
 * - `taskId` is `""` while a freshly inserted block still asks which task it
 *   shows (the slash-menu insert opens a task picker).
 * - `title` (the task's current title), `own` (the reading agent's own
 *   decisions: a count stub instead of the full body) and `missing` (the task
 *   is gone) are ANNOTATED — read-only, discarded on parse.
 * - `body: "derived"`: to any other agent the body lists every decision in
 *   full, as `<decision …>` lines — read-only too, discarded on parse, so the
 *   block round-trips through the same reader's read unchanged.
 */
export const taskDecisionsBlock = defineBlock({
  type: "task-decisions",
  // A task id or `""` (not picked yet), checked at the write boundary too —
  // a malformed id would fail every read of the page that holds it.
  schema: z.object({
    taskId: z.string().refine((id): boolean => id === "" || taskIdKind.is(id), {
      message: "must be a task id (`task-…`) or empty",
    }),
  }),
  label: "Task decisions",
  icon: TASK_DECISIONS_BLOCK_ICON,
  aliases: ["decisions", "agent decisions", "d-items"],
  empty: () => ({ taskId: "" }),
  markdown: {
    tag: {
      name: "task-decisions",
      body: "derived",
      annotated: ["title", "own", "decisions", "shown", "missing"],
      attrs: (data) => ({ task: data.taskId }),
      parseAttrs: (attrs) => {
        const task = attrs.task ?? "";
        if (task !== "" && !taskIdKind.is(task)) {
          throw new Error(
            `markdown: <task-decisions task="${task}"/> — \`task\` must be a task id (\`task-…\`).`,
          );
        }
        for (const name of Object.keys(attrs)) {
          if (name !== "task") {
            throw new Error(
              `markdown: <task-decisions/> takes only \`task\` (and its read-only attributes), not \`${name}\`.`,
            );
          }
        }
        return { taskId: task };
      },
    },
  },
});
