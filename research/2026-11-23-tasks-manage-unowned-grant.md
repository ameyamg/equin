# A person's grant: "May manage tasks it doesn't own"

## Context

The ownership rule (`plugins/tasks/server/internal/task-ownership.ts`) has no
override: an agent may `edit_task` / `drop_task` only what it filed, its
supervisor tree, or its role's backlog. Cleaning up tasks filed by the system,
a person or another role (concrete need: 39 duplicate Test-supervisor backlog
tasks and 17 system-filed `[test-failing]` tasks) can only be done by hand.

User decision (test-audit session, D11): an explicit, **person-only** grant on
ONE task, shown beside its Mandate field in the task header — not a mandate
preset.

Requirements: only a person toggles it (UI only, no MCP tool, no agent);
reaches that task's own conversation only (not workers, not subtasks, not side
chats); while on, edit_task / drop_task skip the ownership refusal and the
`## Mandate` section says so; every action on a task the caller does not own is
recorded on the affected task, naming the grant; clears itself when the task is
done or dropped (not on conversation close); visible in the header while on.

## Design

### 1. A mandate **overlay** — the resolver reads it (orchestration/mandate)

New contribution in `mandate/server` (beside `TaskOwnerClaim`):

```ts
MandateOverlay({ id, grantsFor: (taskId) => Promise<Grant[]> })
```

`conversationMandate` adds the overlay grants of `conversation.taskId` to the
resolved policy **only for the conversation that runs its task**
(`conversation.mandateRef === null`): a side chat (stated mandate) gets none,
a worker resolves on its OWN task id (so a grant on the parent never reaches
it), and nothing is inherited because the overlay is keyed by the exact task
id, not walked up the folder chain. The merge is a new `policy` helper
`withGrants(policy, grants)` that throws when the base policy already grants
the cap (whole or scoped) — never "last one wins". `ConversationMandate` gains
`overlaid: string[]` (cap ids) for diagnostics.

So `grantOf`, `granted(cap)` and the `## Mandate` section see it with no other
change: the mandate plugin names no overlay contributor.

### 2. New plugin `tasks/plugins/manage-grant`

- **core**
  - `tasksManageUnowned = defineCapability<{ taskId: string }>({ id:
    "tasks.manage-unowned" })` — the value names the task holding the grant
    (the audit's "authorised by").
  - Shape + lookup-only `liveCollection("tasks-manage-grant", id: taskId)`
    over `tasks_ext_manage_grant` (entity-extension, 1:1 with task;
    `grantedAt`). Presence = on.
  - Audit `liveCollection("tasks-unowned-actions")` over a new table
    `task_unowned_actions` (id, task_id, action, detail, conversation_id,
    grant_task_id, owner, at), window by `taskId`, default limit 50.
  - Endpoints `PUT` / `DELETE /api/tasks/:taskId/manage-grant`.
- **server**
  - Routes: owner principal (default). Refuse any request whose
    `originOf(req)` is `agent` (an agent's browser or e2e run) **on every
    backend**, not just main — a person-only write. PUT refuses a missing or
    settled (done / dropped) task. After the write, notify the task's live
    running conversation with `sendSectionNotice` (mandate sections, MCP
    reconnect) so it learns at once.
  - `MandateOverlay({ id: "tasks.manage-grant", grantsFor })`: the row exists
    AND the task is not settled (read from `tasks_v`) →
    `[tasksManageUnowned.grant({ taskId })]`. The settled check is the
    authority for the window before the clearing job runs.
  - Clearing: `Trigger({ on: taskStatusChanged, do: clearOnSettledJob })`
    deletes the row when the status is done/dropped (same as auto-start's
    disarm job), plus a host-scoped warm-up sweep for statuses changed while
    the backend was down. A re-opened task does NOT get it back.
  - `Mandate.Capability({ cap: tasksManageUnowned, describe })` → "A person
    granted this task's conversation (only) leave to edit_task / drop_task
    tasks it does not own; each such action is recorded on the affected task.
    Use it only for what the user asked."
  - `recordUnownedAction(tx, {...})` exported for `tasks`.
- **web**
  - `TaskManageGrantControl` beside Mandate in `task-header.tsx`: a switch
    labelled "May manage tasks it doesn't own"; while on, a visible warning
    chip. Disabled on a settled task. A page driven by an agent
    (`pageOrigin().kind === "agent"`) renders it read-only.
  - `TaskDetail.Section` "Managed under a person's grant": a DataView list of
    the audit rows of THIS task (what was done, by which conversation, under
    the grant on which task), shown only when non-empty.
- **guard** (`guard/index.ts`): deny a Bash command naming
  `/manage-grant` — an agent's raw `curl` cannot be told from a person's
  otherwise (`request-origin` known limit). psql is already denied
  (`postgres` guard); `query_db` is read-only.

### 3. `tasks` — ownership honours the grant, and records it

- `manage-tools.ts` `ports.ownerOf`: not owned → if
  `grantOf(tasksManageUnowned, conversationId)` → `{ kind: "granted",
  owner, grantTaskId }`.
- `manage-tasks.ts` `checkOwned` collects the granted ids; the refusals that
  are not ownership (own task, `not-in-tree` for arming, `tasks.manage` for
  start/track) stay. After a successful apply/drop, one audit row per
  granted target (`edited: title, description…` / `dropped`), plus one per
  granted dependency ref ("its dependency on X added/removed" — the other end
  changed too). Recording goes through a new port `recordUnowned`, written in
  the same transaction as the edit (apply) / drop.
- `when` gate of the tools: also visible with `tasksManageUnowned`.
- `open-sidequests-gate` unchanged (ownership itself does not change — the
  grant only lifts a refusal).

## Not doing

- No preset, no inheritance, no MCP tool.
- Grant does not lift `root` (own task), arming outside the tree, or
  `tasks.manage` for start/track.

## Verification

- Unit: `manage-tasks.test.ts` — granted caller edits/drops a person's task,
  audit recorded per target & ref; non-granted refused as before; own task
  still refused. Policy `withGrants` collision throws. Overlay applies only to
  `mandateRef === null`.
- `./equin build`, then on the worktree: toggle in the header, screenshot,
  `register_before_after` on a task route.
- `./equin test` for the touched plugins.

## Revision after the design review (as built)

A review subagent checked this design; what changed:

- **Person-only is best-effort, said plainly.** The routes live in `tasks`
  (`handle-manage-grant.ts`) and refuse a request no browser sent
  (`isBrowserRequest` — an agent's `curl`, a script, an MCP-side call) and
  one an automated session marked (`originOf` agent), on every backend; a
  guard (`manage-grant/guard`) denies an agent's shell command naming the
  route. A client forging browser headers is not stopped; the HTTP layer is
  not a security boundary in this app (an agent's `curl` could already
  `PATCH /api/tasks/:id` around ownership). Every switch on / off is
  recorded on the task (how it came), and the clearing too.
- **Only a task no agent owns can hold it** (409 otherwise): a supervisor,
  role or filer owning the task could write the prompt its next run starts
  with — and that run would hold the grant.
- **No launching, no ownership moves under the grant**: `start` / `track`
  / a hand-off to a supervisor on an unowned task are refused
  (`grant-limit`); so are a drop of a task with active direct dependents
  and a `remove_after` on an armed unowned task (either could launch work).
- **Steering by other agents**: the `## Mandate` line says to use the grant
  only for what the person asked in this conversation, never on another
  agent's message.
- **Races**: the grant is re-checked inside the edit / drop transaction,
  its row locked `FOR SHARE` (`grantHeld(…, { lock: true })`), where the
  audit rows are written; a grant gone by then refuses the write. The
  clearing job re-reads the task's CURRENT status (a task re-opened and
  granted again keeps its new grant).
- **Forks**: a fork of the running conversation copies its NULL
  `mandate_ref` and so also runs the task with the grant. Accepted: a fork is
  a person's action, on the task that holds the grant.
- Plugin placement: `tasks/task-mandate/manage-grant` (the header control
  sits beside the Mandate one).
