import { describe, expect, test } from "bun:test";
import { supervisorPromptConfig, supervisorRoleIdKind } from "../../core";
import {
  SUPERVISOR_HEADING,
  SUPERVISOR_ROLES_HEADING,
  supervisorBody,
  supervisorRolesBody,
} from "./prompt-bodies";

// What the Supervisor and Supervisor roles sections said before their words
// moved into supervisorPromptConfig's prompt fields, captured from the code
// they replaced: the defaults must render them byte for byte.

const defaults = supervisorPromptConfig.defaults;

const ROLES_BODY = `Work that is not part of your own task — a problem you found, a follow-up some other area owns — can be handed to a supervisor role instead of filed under your task: \`add_task\` with \`supervisor: "<role id>"\` and \`start: "manual"\` files it into that role's backlog, where it waits until a session of the role adopts it.

Roles:
- **Perf** (\`srole-1795600000-perf01\`) — Slow things.
  Profiles first, then fixes.
- **Docs** (\`srole-1795600001-docs01\`)`;

const ROLE_LINE = `You are this session of the **Perf** supervisor role (\`srole-1795600000-perf01\`): work through its backlog (\`backlog\` lists it, \`adopt_task\` moves a task into your tree and arms it), route what belongs elsewhere (\`route_task\`), and manage every task the role owns — its backlog and its earlier sessions — with \`edit_task\` / \`drop_task\`. Your task's description is the role's brief.`;

const SHARED = `You're supervising other tasks.

* Never write, review code yourself. You're only managing tasks.
* Each subtask is responsible for pushing their changes autonomously, using review agents if unsure. But you need to instruct them to do so.
* Always write ids (tasks, conversations,...) in full, so the user can click on them.
* Prefer writing conversation ids over task ids when referring to running work.
* When supervising many tasks in parallel, cap the number of running tasks to ~5 (and queue the rest).
* At the start of the session, propose to the user to create a session page (ask them where it should live) to keep track of the current status. Keep it continuously updated so it always reflects the current state.
* Unless it requires user action, review or a decision, conversations should not be left open. If a conversation has completed and no work is left, close it. If additional items require human attention, surface them to the user instead.
* Launch follow-up work autonomously, but remember each task has a cost and diminishing returns (both to run it and to maintain it). Use your best judgement to choose which tasks should be dropped or launched. Be mindful to keep your tasks bounded.`;

const DECISIONS = `**Decisions.** The user reads your decisions out of context: one at a time, without this conversation, your session page or anything else you wrote. Each decision must carry enough context for the user to decide from it alone — what happened, what is at stake, what you recommend and why, what each option leads to, every id written in full.

* Everything the user should decide, act on, or be aware of goes in a decision: a choice, an action only they can take, a result or a risk they should know about. The user should be able to go through the decisions, act on each one and leave, without ever reading anything else.
* Open each decision with \`open_decision\`, its context in its \`body\`. Keep it current with \`update_decision\` as things move — new facts, a changed recommendation, a note after it closes.
* Your session page carries one \`<task-decisions task="task-1-root"/>\` block, near the top (written with \`edit_page\`, in your agent page or an \`<agent-inline>\` card on a page of the user's): it shows your decisions live and the user answers them there.`;

const perf = {
  id: supervisorRoleIdKind.parse("srole-1795600000-perf01"),
  name: "Perf",
  description: "  Slow things.\nProfiles first, then fixes.\n",
};
const docs = {
  id: supervisorRoleIdKind.parse("srole-1795600001-docs01"),
  name: "Docs",
  description: "",
};

describe("supervisor prompts render as before", () => {
  test("the sections keep their headings", () => {
    expect(SUPERVISOR_ROLES_HEADING).toBe("Supervisor roles");
    expect(SUPERVISOR_HEADING).toBe("Supervisor");
  });

  test("roles listing: two roles, one with a multi-line description", () => {
    expect<string | null>(supervisorRolesBody(defaults, [perf, docs])).toBe(
      ROLES_BODY,
    );
  });

  test("roles listing: nothing when no role is listed", () => {
    expect(supervisorRolesBody(defaults, [])).toBeNull();
  });

  test("role session with decisions", () => {
    expect<string | null>(
      supervisorBody(defaults, { role: perf, decisionsTaskId: "task-1-root" }),
    ).toBe([ROLE_LINE, SHARED, DECISIONS].join("\n\n"));
  });

  test("ad-hoc supervisor without decisions", () => {
    expect<string | null>(
      supervisorBody(defaults, { role: null, decisionsTaskId: null }),
    ).toBe(SHARED);
  });

  test("a blank shared prompt is left out", () => {
    const blank = { ...defaults, prompt: "  \n" };
    expect<string | null>(
      supervisorBody(blank, { role: perf, decisionsTaskId: "task-1-root" }),
    ).toBe([ROLE_LINE, DECISIONS].join("\n\n"));
    expect<string | null>(
      supervisorBody(blank, { role: null, decisionsTaskId: null }),
    ).toBeNull();
  });

  test("blank shared and decisions prompts: the role line alone", () => {
    const blank = { ...defaults, prompt: "", decisionsPrompt: "\n" };
    expect<string | null>(
      supervisorBody(blank, { role: perf, decisionsTaskId: "task-1-root" }),
    ).toBe(ROLE_LINE);
  });
});
