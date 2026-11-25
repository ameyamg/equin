# A run's end is its report: retire `submit_outcome_report`

## Context

Agents whose mandate grants `report.required` (supervisor workers, sidequest
autopilot, upstream merges, deps updates) must call `submit_outcome_report`
before they stop. A stop gate (`outcome-report/machine/internal/stop-gate.ts`)
refuses every stop until they do.

The gate cannot tell *why* an agent stops, so it fires when the agent isn't
done. Incident `conv-1795638366-ye3yup` (2026-11-25):

- The worker asked the user with `AskUserQuestion` (20:32), as it should.
- The user answered (20:38), and the agent replied.
- At its stop (20:38:59) the gate demanded a final report in the middle of a
  conversation with the user. The worker filed one for unfinished work, and
  every later user turn went through the gate again.

The flaw is that reporting is an obligation separate from stopping, so a gate
has to guess. Claude Code's subagents have no report tool: **the end of a run
is the hand-back**, and the caller always gets its last message. A subagent
cannot forget to report, and it never has to "exit".

What the user decided:

- `submit_outcome_report` goes.
- A question that blocks a task goes through `AskUserQuestion`. Decisions stay
  a supervisor-root concept: things it collected in the background.
- A turn the user typed notifies no supervisor.
- "Done" must not depend on the agent calling `exit_clean`, which it may
  forget or not want.

## The model

A **run** is the sequence of turns since the conversation last started work
on its own. Each stop is classified by who drives the run and whether it is
really over:

| At a turn end (`conversation.turn-completed`) | Report row | Watcher | Automation slot | Bell |
|---|---|---|---|---|
| Driver **task**, not waived (run over) | upsert: last message + standing | `reported` (woken) | released | — |
| Driver **task**, waived (background work, busy watched subtree, compaction) | — | — | — | — |
| Agent holds an `AskUserQuestion` (`waitingFor: "question"`) | — | `asking` once (on the `waitingFor` change) | released | rung |
| Driver **person** (the user typed the latest turn) | upsert quietly, `driver: person` | not woken; the digest shows it | released | — |

"Waived" reuses the stop gate's `StopWaiver` contributions: each already
says "the agent will be woken", so "the run isn't over" means the same thing.
No second notion of pending work.

An answer to a question continues the run. That includes the marker path a
hibernated question degrades to, so the stop after the user's answer is still
reported to the watcher. `exit_clean` means only "close the conversation";
its `settled` / `stopped` watch events already exist.

## Changes

### 1. Every turn says where it came from (turn-ledger)

Add `origin: "person" | "task" | "continue"` to `conversation_turns` and make
it **required** on `TurnSubmission` (`conversations/server/internal/turns.ts`
`submitTurn`), so a new sender can't leave it unset (tsc rejects it).

- `person`: a typed `turn`, `push-and-exit`, decisions answers
  (`decisions/machine/internal/answers-endpoint.ts`).
- `task`: `launch`, watch batches (`watch/machine/internal/jobs.ts`),
  `message_agent` (`message/server/internal/deliver.ts`), supervisor-roles
  events.
- `continue`: an AskUserQuestion `answer` (and the marker answer), `compact`
  and its continuation (`self-compact`), auto-resume after an API error
  (`runtime-sdk/machine/internal/resume-stopped.ts`, today kind `turn` with
  nobody typing), mandate change-notice, compaction delivery-check, stop-gate
  reminders.

Existing rows are backfilled from `kind`: `turn` / `push-and-exit` → person,
`launch` / `event` → task, `answer` / `compact` → continue.

**The run's driver** is the origin of the conversation's latest accepted row
whose origin is not `continue` (`submitted_at` order), read by a new
turn-ledger export `runDriver(conversationId)`. A person typing into a busy
autonomous turn makes that run the person's: they stepped in.

### 2. Capture at the turn end (outcome-report, `machine/`)

Add a durable job on `conversationTurnCompleted`
(`conversations/server/internal/tables-turn-completed-event.ts`, a
`defineTriggerEvent`; the payload already has the final message's `text`). It
runs only for conversations whose mandate grants the capability (§5), and
holds the decision as a pure function, `runEnd({ driver, waived, waitingFor })`,
tested over the table above.

1. Run still going (`waitingFor === "question"`, or some StopWaiver waives) →
   nothing. Add a stop-gate server export `stopWaivedBy(conversationId)`,
   which is the waiver half of `decide.ts`.
2. Measure `standing` with `getAttemptStanding`
   (`attempt-work/server/internal/work.ts:428`). If it is unresolved, the job
   fails loudly and the job runner retries it, a bound around git. Never a
   guessed value.
3. Upsert `tasks_ext_outcome_report`: `{ conversationId, body: text, standing,
   driver, messageId, submittedAt }`. Drop `question` and `answers`. If the
   final message has no text, store an empty body and render "ended its turn
   without a message" (not an invented summary).
4. Driver `task` → emit `outcomeReportSubmitted`, which the existing watch
   source maps to `reported`. Driver `person` → upsert only.
5. Call `releaseLaunchedTask(taskId)` directly
   (`automations/server/internal/release.ts`; it is idempotent, and
   outcome-report → automations is the allowed direction). Remove the
   `REPORT_KINDS` release branch from `automations/server/internal/slot-watch.ts`,
   so there is one release path. That also covers user-driven runs, which
   today hold a slot until the task status changes.

### 3. Questions: `asking` + bell

Add a watch source on `conversation.statusChanged` where `waitingFor` becomes
`"question"` and `previousWaitingFor` wasn't (capability-scoped). Its event
is `asking`, with the question text read from question-relay's open
`pending_questions` row (new server export `openQuestionOf(conversationId)`).
`releaseLaunchedTask` runs here too.

The bell uses `recordNotification` with the outcome tool's shape, which moves
here: `"Your call: <task title>"`, linked to the conversation, deduped per
conversation, re-alerting on each new question.

Hibernation is unchanged. A question idle for 24 h degrades to the marker
answer (an answer sent as a message), which is `continue`, so the run and the
hand-back survive it.

### 4. Delete

- `submit_outcome_report` (`machine/internal/mcp-tools.ts`), `next-step.ts`
  (+ test) and `report-line.ts`.
- The `outcome-report` StopGate. The stop-gate plugin and its backstop stay:
  `decisions.owed` still gates. Reword the backstop comment.
- The tool-call renderer sub-plugin
  `conversations/.../jsonl-viewer/plugins/tool-call/plugins/outcome-report`.
- The answer buttons in `OutcomeReportCard` / `outcome-report-view.tsx`. The
  question now lives in the AskUserQuestion card.

### 5. Rename the capability and rewrite the prompts

- `report.required` → `report.handback` ("this conversation's runs hand back
  to whoever started them"), in `plugins/capability`. Same 4 grant sites:
  `mandate-presets/shared/policies.ts:89`,
  `sidequest-autopilot/server/internal/automation.ts:56`,
  `upstream/machine/internal/merge-automation.ts:58` and
  `deps/plugins/updates/server/internal/detect-job.ts:101`. Composition
  `compositions.origin.jsonc:240`.
- The mandate line (`core/prompts.ts`, pinned by `prompts-unchanged.test.ts`):
  "The user is not watching: work on your own. If only the user can unblock
  you, ask with `AskUserQuestion` — it waits for their answer. When you stop,
  your last message is your report to whoever started you: what you did, what
  is left, what they must know."
- Sidequest autopilot prompt (`sidequest-autopilot/shared/config.ts` + its
  `.origin.jsonc`): the "call `submit_outcome_report` exactly once" and
  "decision question" lines become "end with your report as your final
  message" and "ask with AskUserQuestion". The five-part format stays, as the
  final message.
- `exitWhenDone` in the push-and-exit capabilities prompt ("…your outcome
  report submitted…"). The `fix-history.ts:131` wording. The automations UI
  strings ("finishes or reports").

### 6. Readers

- `OutcomeReportCard` (TranscriptEnd): the body is already the transcript's
  last message, so the card shows only the standing badge (pushed /
  branch waiting / no changes).
- `OutcomeReportDetail` (automation History) keeps body + standing.
- The digest annotation (`machine/internal/annotation.ts`) adds "· with the
  user" for `driver: person`, so a supervisor reading its tree sees the
  worker is with the user, not stuck.
- The migration (generated by `./equin build`) drops `question` / `answers`
  and adds `driver`, and adds `conversation_turns.origin` with the backfill.

## Verification

- Unit tests:
  - `runEnd`: the full table.
  - `runDriver`: continue rows skipped, a folded person turn.
  - Origin required: a tsc failure without it.
  - `slotDecision` without report kinds.
  - Prompts-unchanged updates.
- DB-backed test (db-test-fixture): turn-completed for a task-driven
  conversation upserts and emits `reported`, a person-driven one upserts
  quietly, and a waived one writes nothing.
- On my build (`./equin build`), as an e2e under `outcome-report/e2e/`:
  1. Launch a supervisor worker. It ends with no tool call: `reported` reaches
     the supervisor, and the card shows the standing.
  2. The worker asks with `AskUserQuestion`: the bell rings and the
     supervisor gets `asking`. Answer it: the next stop is `reported`, with no
     stop-hook feedback in the transcript.
  3. Type a follow-up into the worker: the row updates with
     `driver: person`, and the supervisor is not woken.
  4. Sidequest autopilot with an at-once cap of 1: the slot frees at the
     worker's stop without any tool call.
- `./equin check` (boundaries: outcome-report → stop-gate / turn-ledger /
  question-relay server exports).
