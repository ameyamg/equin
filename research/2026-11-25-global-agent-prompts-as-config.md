# Agent prompt text is config, never code

## Context

Every instruction an agent reads in its system prompt should be visible to and
editable by the user. Some are config today (shared supervisor prompt,
decisions prompt, Ask equin instructions, triage, push-and-exit, automation
templates). The rest is hard-coded prose: `SystemPrompt.Section.render` and
`Mandate.Capability.describe` return `string`, so nothing pushes a new section
toward config. 0b44ce62fa put supervisor guidance in code on the false belief
that an override hides a new default (reverted in 3735a2e1aa). Goal: make
hard-coded section/capability prose **unwritable** (rung 1/2), move every
existing piece onto config, keep rendered output byte-identical.

## The primitive — new plugin `config_v2/plugins/prompts`

- **core** `promptField({ label, description, default, rows, variables })`:
  a multiline-text config field (reuses `multilineTextFieldType`, so Settings →
  Config renders it with no new editor) whose `schema` is `z.string()` refined
  by `unknownTemplateVariables(template, variables)`. `setConfig` already
  parses the field schema (`config_v2/server/internal/registry.ts:767`), so an
  unknown `{{var}}` is refused **at every save**: Settings → Config, panes, the
  API. A hand-edited override that fails resolves to origin and surfaces as an
  `invalid` conflict (existing tier-logic). The description gets the variable
  list appended (`{{name}} (what it holds)`), the way `askConfig` writes it by
  hand today. The field def carries `variables` typed as a const tuple so
  `V = names` is inferred.
- **core** `PromptText`: a string branded with a non-exported unique symbol.
  Minted only by rendering a prompt field (below) or `joinPromptTexts(parts,
  sep)` (drops blanks). No `string → PromptText` door.
- **server** `renderConfigPrompt(config, key, values: Record<V, string>):
  PromptText` — `getConfig(config)[key]` through `renderPrompt`; tsc requires
  every declared variable; an unknown one (unreachable past the schema) throws
  naming the config. Pure twin `fillPromptField(field, template, values)` for
  tests and web.

## Sections and capabilities take prompts, not text

- `SystemPromptSection` (`conversations/system-prompt/server/internal/registry.ts`):
  - `render(conversationId): Promise<PromptText | null>` — a `string` no
    longer type-checks.
  - new required `heading` (data: a title, like `label`). The composer writes
    `## {heading}\n\n` before the body, exactly what every section writes by
    hand today (supervisor-prompt's heading is `Supervisor`, its label stays
    `Supervisor prompt`).
  - a data-only variant `listing(conversationId): Promise<string | null>`
    (union with `render`) for generated listings: documented as "data, never
    instructions".
- `MandateCapabilityEntry.describe: (value) => PromptText | null`.
  `renderMandateInstructions` keeps the `- ` bullets and joins them (structure).
- Why `PromptText`-returning `render` rather than a literal `{ prompt,
  variables }` pair: several sections are composed of 2–3 prompts with
  conditional parts (supervisor: role line + shared + decisions; page
  instructions: intro + globals + one line per page), and templates have no
  conditionals. Returning a type only a config prompt can mint gives the same
  guarantee (no string path) and covers those sections without wrapper
  templates such as `## Supervisor\n\n{{body}}`.

## Where the line between prose and data falls

Data (stays in code, as variable values or a `listing`): the tree digest
(task ids, titles, status words, the `+N more — call task_tree` overflow; it's
the same text `add_task` / `task_tree` results carry), the roles list (name,
id, the user's own description), the page instruction cards as
`<instructions-from>` XML (user-authored), the `<instructions-page …/>` tag,
the filing grant's track/start list (`track "main": start "after"`), headings,
bullets and separators. Prose: every sentence telling the agent what to do or
what something means.

## What moves (default = today's text verbatim)

| Owner config (plugin core) | Prompt fields | Variables |
|---|---|---|
| `tasks/supervisor-roles` `supervisorPromptConfig` (existing) | `roleSessionPrompt` (new), `rolesPrompt` (new: intro + `Roles:` + list), `decisionsPrompt` → promptField | roleName, roleId · roles · taskId |
| `tasks/outcome-report` | `mandateLine` ("The user is not watching…") | reportTool |
| `tasks/orchestration/watch` | `childrenLine`, `treeLine` | — |
| `tasks/task-mandate/manage-grant` | `mandateLine` | — |
| `tasks` (tasks.file) | `mandateLine` ("You may file tasks… — {{grant}}. Any other…"), `defaultAfterNone`, `backlog` clauses (joined with `; ` by code, as today) | grant |
| `push-and-exit/capabilities` | `pushOnRequest`, `pushNever`, `pushSafe`, `pushChecks`, `mandatePushLine` ("Pushing: {{policy}}"), `exitOnRequest`, `exitWhenDone` | policy |
| `tasks/task-source-url` | `sourcePage` | url |
| `page/annotations/agent-access` | `intro`, `globalsIntro`, `pageLine` (`Read this page … "{{coveredTitle}}".`) | coveredTitle |
| `hints/ask` `askConfig.instructions` | → promptField (gains save-time refusal) | as today |

`PUSH_POLICY_TEXT` / `MANDATE_PUSH_POLICY_TEXT` / `EXIT_WHEN_TEXT` are deleted;
their other readers read the same config, so no copy survives: automations'
`fillPrompt` (`{{pushPolicy}}`), `upstream/web/components/updates-row.tsx`
(`useConfig`), outcome-report's `next-step.ts` ("Report saved. " + exit text),
the deps upgrade-prompt test (field `defaultValue`). `describeFilingGrant`
(also used by `add_task` text) reads the same clause prompts.

Supervisors pane (`supervisor-roles/plugins/pane/web/components/shared-detail.tsx`):
add the role-session and roles-listing prompts beside Shared / Decisions;
its save check uses the fields' declared `variables` instead of
`DECISIONS_PROMPT_VARIABLES` (removed).

## Wording

All defaults unchanged. Flagged, not rewritten: outcome-report's "never ask
questions mid-way — decide, or stop" also forbids a question about the user's
own settings; now editable, so the user decides. Any other wording that reads
wrong once editable is listed in the report, not silently changed.

## Docs

- `config_v2/CLAUDE.md` override semantics: "a user's override is their
  decision, never an obstacle" — a new default reaches them through conflict /
  auto-merge; guidance every user must get is a new prompt, never text
  appended in code.
- `conversations/system-prompt/CLAUDE.md`: "instructions are config, not
  code" — `PromptText`, `heading`, `listing`, where the data line falls.
- `tasks/supervisor-roles/CLAUDE.md`: same rule, pointing at the pane.
- `config_v2/plugins/prompts/CLAUDE.md`: the primitive.

## Verification

- `prompts-unchanged.test.ts` per owner: today's output as literals (captured
  from the old functions before deleting them) vs. new render with defaults,
  for representative inputs (each push/exit value, a role session with and
  without decisions, page section with 0 / cards / pages, filing grants with and
  without `defaultAfter: none` / backlog, a source url).
- `promptField` test: unknown variable refused by the schema; known accepted.
- tsc: a section returning a `string` fails (a `@ts-expect-error` test).
- `./equin build`, `./equin test` on touched paths, `./equin check`.
- Review agent on `git diff $(git merge-base HEAD main)`.
- `register_before_after` on Settings → Config (new prompt entries) and the
  Supervisors pane.
- Push autonomously (task authorizes it).
