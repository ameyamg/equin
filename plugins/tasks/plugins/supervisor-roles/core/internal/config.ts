import { defineConfig } from "@plugins/config_v2/core";
import { promptField } from "@plugins/config_v2/plugins/prompts/core";

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

/**
 * Who a role's session is and how it works its role, unless the user wrote
 * their own. `{{roleName}}` / `{{roleId}}` are the role's, filled at render.
 */
const DEFAULT_ROLE_SESSION_PROMPT =
  "You are this session of the **{{roleName}}** supervisor role (`{{roleId}}`): work through its backlog (`backlog` lists it, `adopt_task` moves a task into your tree and arms it), route what belongs elsewhere (`route_task`), and manage every task the role owns — its backlog and its earlier sessions — with `edit_task` / `drop_task`. Your task's description is the role's brief.";

/**
 * How an agent that may file into a backlog hands work to a supervisor role,
 * unless the user wrote their own. `{{roles}}` is the listed roles (one item
 * each), filled at render.
 */
const DEFAULT_ROLES_PROMPT = `Work that is not part of your own task — a problem you found, a follow-up some other area owns — can be handed to a supervisor role instead of filed under your task: \`add_task\` with \`supervisor: "<role id>"\` and \`start: "manual"\` files it into that role's backlog, where it waits until a session of the role adopts it.

Roles:
{{roles}}`;

/**
 * The shared supervisor prompt: what every supervisor session's root is told,
 * ad-hoc supervisors (the Supervisor launch option) and role sessions alike —
 * before a role session's own brief (its role's prompt, the task it starts
 * with) and any per-task preprompt. Workers below a root never get it.
 */
export const supervisorPromptConfig = defineConfig({
  name: "Supervisors",
  fields: {
    prompt: promptField({
      label: "Shared supervisor prompt",
      description:
        "What every supervisor session is told at its root (ad-hoc supervisors and every role's sessions), ahead of the role's own prompt. Empty: nothing.",
      default: DEFAULT_SUPERVISOR_PROMPT,
      rows: 12,
    }),
    decisionsPrompt: promptField({
      label: "Decisions prompt",
      description:
        "How every supervisor session records what needs the user, told at its root after the shared prompt. Empty: nothing.",
      default: DEFAULT_DECISIONS_PROMPT,
      rows: 10,
      variables: [
        { name: "taskId", description: "the supervisor's root task id" },
      ],
    }),
    roleSessionPrompt: promptField({
      label: "Role session prompt",
      description:
        "What a supervisor role's session is told at its root, ahead of the shared prompt: which role it works for and how it works the role's backlog.",
      default: DEFAULT_ROLE_SESSION_PROMPT,
      rows: 4,
      variables: [
        { name: "roleName", description: "the role's name" },
        { name: "roleId", description: "the role's id" },
      ],
    }),
    rolesPrompt: promptField({
      label: "Supervisor roles prompt",
      description:
        "What an agent that may file into a backlog is told about handing work to a supervisor role (its Supervisor roles section). Not sent while no role is listed.",
      default: DEFAULT_ROLES_PROMPT,
      rows: 6,
      variables: [
        {
          name: "roles",
          description:
            "the listed roles, one list item each: name, id and description",
        },
      ],
    }),
  },
});
