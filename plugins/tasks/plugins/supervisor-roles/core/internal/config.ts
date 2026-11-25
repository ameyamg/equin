import { defineConfig } from "@plugins/config_v2/core";
import type { PromptVariable } from "@plugins/packages/plugins/prompt-template/core";
import { multilineTextField } from "@plugins/fields/plugins/multiline-text/plugins/config/core";

/** What every supervisor is told unless the user wrote their own. */
const DEFAULT_SUPERVISOR_PROMPT = `You're supervising other tasks.

* Never write, review code yourself. You're only managing tasks.
* Each subtask is responsible for pushing their changes autonomously, using review agents if unsure. But you need to instruct them to do so.
* Always write ids (tasks, conversations,...) in full, so the user can click on them.
* Prefer writing conversation ids over task ids when referring to running work.
* When supervising many tasks in parallel, cap the number of running tasks to ~5 (and queue the rest).
* At the start of the session, propose to the user to create a session page (ask them where it should live) to keep track of the current status. Keep it continuously updated so it always reflects the current state.
* Unless it requires user action, review or a decision, conversations should not be left open. If a conversation has completed and no work is left, close it. If additional items require human attention, surface them to the user instead.
* Launch follow-up work autonomously, but remember each task has a cost and diminishing returns (both to run it and to maintain it). Use your best judgement to choose which tasks should be dropped or launched. Be mindful to keep your tasks bounded.
`;

/**
 * How a supervisor records what needs the user, unless the user wrote their
 * own. `{{taskId}}` is the supervisor's root task id, filled at render.
 */
const DEFAULT_DECISIONS_PROMPT = `**Decisions.** The user reads your decisions out of context: one at a time, without this conversation, your session page or anything else you wrote. Each decision must carry enough context for the user to decide from it alone — what happened, what is at stake, what you recommend and why, what each option leads to, every id written in full.

* Everything the user should decide, act on, or be aware of goes in a decision: a choice, an action only they can take, a result or a risk they should know about. The user should be able to go through the decisions, act on each one and leave, without ever reading anything else.
* Open each decision with \`open_decision\`, its context in its \`body\`. Keep it current with \`update_decision\` as things move — new facts, a changed recommendation, a note after it closes.
* Your session page carries one \`<task-decisions task="{{taskId}}"/>\` block, near the top (written with \`edit_page\`, in your agent page or an \`<agent-inline>\` card on a page of the user's): it shows your decisions live and the user answers them there.
`;

/** The variables the decisions prompt may use, filled for each supervisor. */
export const DECISIONS_PROMPT_VARIABLES: readonly PromptVariable[] = [
  { name: "taskId", description: "The supervisor's root task id" },
];

/**
 * The shared supervisor prompt: what every supervisor session's root is told,
 * ad-hoc supervisors (the Supervisor launch option) and role sessions alike —
 * before a role session's own brief (its role's prompt, the task it starts
 * with) and any per-task preprompt. Workers below a root never get it.
 */
export const supervisorPromptConfig = defineConfig({
  name: "Supervisors",
  fields: {
    prompt: multilineTextField({
      label: "Shared supervisor prompt",
      description:
        "What every supervisor session is told at its root (ad-hoc supervisors and every role's sessions), ahead of the role's own prompt. Empty: nothing.",
      default: DEFAULT_SUPERVISOR_PROMPT,
      rows: 12,
    }),
    decisionsPrompt: multilineTextField({
      label: "Decisions prompt",
      description:
        "How every supervisor session records what needs the user, told at its root after the shared prompt. `{{taskId}}` is the supervisor's root task id. Empty: nothing.",
      default: DEFAULT_DECISIONS_PROMPT,
      rows: 10,
    }),
  },
});
